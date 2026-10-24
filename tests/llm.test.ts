import { describe, it, expect, vi } from "vitest";
import { askLLM, readLLMConfig, LLMError, type LLMConfig } from "@/lib/ai/llm";
import { validateQuestion, MAX_QUESTION_LENGTH } from "@/lib/ai/types";

const config: LLMConfig = {
  apiKey: "test-key",
  baseUrl: "https://llm.example/v1",
  model: "test-model",
  timeoutMs: 1000,
};

const okResponse = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe("validateQuestion", () => {
  it("rejects empty and non-string input", () => {
    expect(validateQuestion("")).toMatch(/empty/);
    expect(validateQuestion("   ")).toMatch(/empty/);
    expect(validateQuestion(undefined)).toMatch(/empty/);
    expect(validateQuestion(42)).toMatch(/empty/);
  });
  it("rejects overly long input", () => {
    expect(validateQuestion("a".repeat(MAX_QUESTION_LENGTH + 1))).toMatch(/at most/);
  });
  it("accepts a normal question", () => {
    expect(validateQuestion("What is 2+2?")).toBeNull();
  });
});

describe("readLLMConfig", () => {
  it("requires an API key", () => {
    expect(() => readLLMConfig({})).toThrow(LLMError);
    try {
      readLLMConfig({ LLM_API_KEY: " " });
    } catch (e) {
      expect((e as LLMError).status).toBe(503);
    }
  });
  it.each(["0", "-1", "NaN", "Infinity", "1.5", "120001"])("rejects unsafe timeout %s", (timeout) => {
    expect(() => readLLMConfig({ LLM_API_KEY: "k", LLM_TIMEOUT_MS: timeout })).toThrow(/timeout/);
  });
  it("applies defaults and trims the base URL", () => {
    const c = readLLMConfig({ LLM_API_KEY: "k" });
    expect(c.baseUrl).toBe("https://api.openai.com/v1");
    expect(c.model).toBe("gpt-4o-mini");
    expect(readLLMConfig({ LLM_API_KEY: "k", LLM_BASE_URL: "http://x/v1/" }).baseUrl).toBe("http://x/v1");
  });
  it("uses the main model for vision on Gemini only, unless overridden", () => {
    const gemini = "https://generativelanguage.googleapis.com/v1beta/openai/";
    expect(readLLMConfig({ LLM_API_KEY: "k", LLM_BASE_URL: gemini, LLM_MODEL: "g" }).visionModel).toBe("g");
    expect(readLLMConfig({ LLM_API_KEY: "k", LLM_BASE_URL: gemini, LLM_MODEL: "g", LLM_VISION_MODEL: "v" }).visionModel).toBe("v");
    expect(readLLMConfig({ LLM_API_KEY: "k", LLM_MODEL: "g" }).visionModel).toBeUndefined();
  });
});

describe("askLLM", () => {
  it("sends an OpenAI-compatible request and returns the answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse("  Four.  "));
    const answer = await askLLM("What is 2+2?", config, fetchMock);
    expect(answer).toBe("Four.");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://llm.example/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("test-model");
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "What is 2+2?" });
  });

  it("maps auth, rate-limit, and server errors without leaking provider bodies", async () => {
    const respond = (status: number) =>
      vi.fn().mockResolvedValue(new Response("secret provider detail", { status }));
    await expect(askLLM("q", config, respond(401))).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/API key/) });
    await expect(askLLM("q", config, respond(429))).rejects.toMatchObject({ status: 429 });
    const err = await askLLM("q", config, respond(500)).catch((e) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err.message).not.toContain("secret");
  });

  it("handles network failures and timeouts", async () => {
    await expect(askLLM("q", config, vi.fn().mockRejectedValue(new TypeError("fetch failed")))).rejects.toMatchObject({ status: 502 });
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    await expect(askLLM("q", config, vi.fn().mockRejectedValue(timeout))).rejects.toMatchObject({ status: 504 });
  });

  it("maps a timeout while reading the response body to 504", async () => {
    const response = new Response("{}");
    vi.spyOn(response, "json").mockRejectedValue(new DOMException("sensitive detail", "AbortError"));
    await expect(askLLM("q", config, vi.fn().mockResolvedValue(response))).rejects.toMatchObject({
      status: 504, message: "The AI provider took too long to respond",
    });
  });

  it("rejects empty or malformed responses", async () => {
    await expect(askLLM("q", config, vi.fn().mockResolvedValue(okResponse("")))).rejects.toMatchObject({ status: 502 });
    await expect(askLLM("q", config, vi.fn().mockResolvedValue(new Response("not json", { status: 200 })))).rejects.toMatchObject({ status: 502 });
  });
});
