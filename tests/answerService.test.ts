import { describe, it, expect, vi } from "vitest";
import { generateAnswer, extractJSONObject, normalizeQuestion } from "@/lib/ai/answerService";
import { LLMError, type LLMConfig } from "@/lib/ai/llm";
import { ANSWER_SCHEMA_VERSION } from "@/lib/ai/answerSchema";

const config: LLMConfig = {
  apiKey: "test-key",
  baseUrl: "https://llm.example/v1",
  model: "m",
  timeoutMs: 1000,
};

const completion = (content: string, model = "m") =>
  new Response(JSON.stringify({ model, choices: [{ message: { content } }] }), { status: 200 });

const validDoc = {
  schemaVersion: ANSWER_SCHEMA_VERSION,
  title: "Answer",
  blocks: [{ id: "x", type: "paragraph", text: "It is four." }],
};

describe("extractJSONObject", () => {
  it("parses clean JSON, fenced JSON, and JSON embedded in prose", () => {
    expect(extractJSONObject('{"a":1}')).toEqual({ a: 1 });
    expect(extractJSONObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJSONObject('Sure! {"a":1} hope this helps')).toEqual({ a: 1 });
  });
  it("returns undefined for non-JSON and oversized content", () => {
    expect(extractJSONObject("no json here")).toBeUndefined();
    expect(extractJSONObject(`{"a":"${"x".repeat(70_000)}"}`)).toBeUndefined();
  });
});

describe("normalizeQuestion", () => {
  it("trims and collapses blank runs", () => {
    expect(normalizeQuestion("  a\n\n\n\nb  ")).toBe("a\n\nb");
  });
});

describe("generateAnswer", () => {
  it("returns a validated document with normalized ids and unverified metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      completion(JSON.stringify({
        ...validDoc,
        blocks: [
          { id: "dup", type: "paragraph", text: "one" },
          { id: "dup", type: "paragraph", text: "two" },
        ],
      }))
    );
    const doc = await generateAnswer("What is 2+2?", config, fetchMock);
    expect(doc.blocks.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(doc.metadata?.verificationStatus).toBe("unverified");
    expect(doc.metadata?.model).toBe("m");
    expect(doc.metadata?.generatedAt).toBeTypeOf("number");

    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init.body).response_format.type).toBe("json_schema");
  });

  it("falls back to json_object mode when the provider rejects json_schema", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unsupported", { status: 400 }))
      .mockResolvedValueOnce(completion(JSON.stringify(validDoc)));
    const doc = await generateAnswer("q", config, fetchMock);
    expect(doc.title).toBe("Answer");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body2 = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body2.response_format).toEqual({ type: "json_object" });
  });

  it("retries once in json_object mode when content is not JSON, then succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion("Sorry, I cannot help."))
      .mockResolvedValueOnce(completion("```json\n" + JSON.stringify(validDoc) + "\n```"));
    const doc = await generateAnswer("q", config, fetchMock);
    expect(doc.blocks[0]).toMatchObject({ type: "paragraph" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails with a controlled error after exhausting attempts on malformed output", async () => {
    // A Response body can only be read once — mock a fresh one per call.
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(completion("not json at all")));
    await expect(generateAnswer("q", config, fetchMock)).rejects.toMatchObject({
      name: "AnswerError",
      status: 502,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // bounded
  });

  it("fails cleanly when the response fails schema validation", async () => {
    const bad = { schemaVersion: 1, title: "T", blocks: [{ id: "b", type: "nonsense" }] };
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(completion(JSON.stringify(bad))));
    await expect(generateAnswer("q", config, fetchMock)).rejects.toMatchObject({ status: 502 });
  });

  it("does not retry auth, rate-limit, or server errors", async () => {
    for (const status of [401, 403, 429, 500]) {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("x", { status })));
      await expect(generateAnswer("q", config, fetchMock)).rejects.toBeInstanceOf(LLMError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("propagates timeouts without retrying", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("t", "TimeoutError"));
    await expect(generateAnswer("q", config, fetchMock)).rejects.toMatchObject({ status: 504 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never exposes the API key or upstream body in errors", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response("upstream mentions test-key secretly", { status: 500 }))
    );
    const err = await generateAnswer("q", config, fetchMock).catch((e) => e);
    expect(err.message).not.toContain("test-key");
    expect(err.message).not.toContain("upstream");
  });
});
