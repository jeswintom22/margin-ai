import { describe, it, expect, vi, afterEach } from "vitest";
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

  it("returns the provider answer", async () => {
    vi.stubEnv("LLM_API_KEY", "k");
    vi.stubEnv("LLM_BASE_URL", "https://llm.example/v1");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "Hello!" } }] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await post({ question: "hi" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ answer: "Hello!" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://llm.example/v1/chat/completions");
  });
});
