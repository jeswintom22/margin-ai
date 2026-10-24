import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { enforceRequestLimit, RequestError, MAX_REQUEST_BYTES } from "@/lib/ai/requestProtection";

vi.mock("@/lib/ai/requestProtection", async (original) => ({
  ...await original<typeof import("@/lib/ai/requestProtection")>(),
  enforceRequestLimit: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(enforceRequestLimit).mockReset();
});
import { POST } from "@/app/api/ask/route";

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/ask", () => {
  it.each([{}, { question: "" }, { question: " " }, { question: "a".repeat(4001) }])("rejects invalid question %j", async (body) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await post(body)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized streamed and declared bodies without forwarding", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await post({ question: "hi", padding: "x".repeat(MAX_REQUEST_BYTES) })).status).toBe(413);
    const response = await POST(new Request("http://localhost/api/ask", {
      method: "POST", headers: { "content-length": String(MAX_REQUEST_BYTES + 1) }, body: "{}",
    }));
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a non-sensitive rate-limit response before parsing or calling the LLM", async () => {
    vi.mocked(enforceRequestLimit).mockImplementation(() => {
      throw new RequestError("Too many requests; try again shortly", 429, 12);
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await post("invalid json");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("12");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Too many requests; try again shortly" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hides unexpected errors and does not log questions or secrets", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(enforceRequestLimit).mockImplementation(() => { throw new Error("private-key private-question"); });
    const response = await post({ question: "private-question" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unexpected server error" });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it.each([401, 403, 429, 500])("sanitizes upstream HTTP %s", async (status) => {
    vi.stubEnv("LLM_API_KEY", "private-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-key private-question upstream body", { status })));
    const response = await post({ question: "private-question" });
    expect(response.status).toBe(status === 429 ? 429 : 502);
    const text = await response.text();
    expect(text).not.toMatch(/private-key|private-question|upstream body|stack/i);
  });

  it("maps upstream timeouts to 504", async () => {
    vi.stubEnv("LLM_API_KEY", "private-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("private-key", "TimeoutError")));
    const response = await post({ question: "hi" });
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: "The AI provider took too long to respond" });
  });

  it("returns 400 for invalid bodies", async () => {
    expect((await post("not json")).status).toBe(400);
    const res = await post({ question: "  " });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Question must not be empty" });
  });

  it("returns 503 when no API key is configured", async () => {
    vi.stubEnv("LLM_API_KEY", "");
    const res = await post({ question: "hi" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/LLM_API_KEY/);
  });

  it("returns a validated structured answer", async () => {
    vi.stubEnv("LLM_API_KEY", "k");
    vi.stubEnv("LLM_BASE_URL", "https://llm.example/v1");
    const doc = {
      schemaVersion: 1,
      title: "Greeting",
      blocks: [{ id: "x", type: "paragraph", text: "Hello!" }],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(doc) } }] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await post({ question: "hi" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer.title).toBe("Greeting");
    expect(body.answer.blocks[0]).toMatchObject({ type: "paragraph", text: "Hello!" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://llm.example/v1/chat/completions");
  });

  it("returns 502 when the model produces invalid structured output", async () => {
    vi.stubEnv("LLM_API_KEY", "k");
    // Fresh Response per call: a body can only be read once, and the service retries once.
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: "just prose, no JSON" } }] }), { status: 200 })
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await post({ question: "hi" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/structured answer/i);
  });
});
