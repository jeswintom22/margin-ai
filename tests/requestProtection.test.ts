import { describe, it, expect, vi, afterEach } from "vitest";
import { createLocalLimiter, enforceRequestLimit, readRequestJSON, MAX_REQUEST_BYTES } from "@/lib/ai/requestProtection";

afterEach(() => vi.unstubAllEnvs());

const request = (body: string, headers?: HeadersInit) => new Request("http://localhost/api/ask", {
  method: "POST", body, headers,
});

describe("request protection", () => {
  it("limits requests deterministically and resets at the window boundary", () => {
    let time = 1000;
    const limit = createLocalLimiter(() => time);
    limit(2, 10000);
    limit(2, 10000);
    expect(() => limit(2, 10000)).toThrow(expect.objectContaining({ status: 429, retryAfter: 10 }));
    time = 10999;
    expect(() => limit(2, 10000)).toThrow(expect.objectContaining({ retryAfter: 1 }));
    time = 11000;
    expect(() => limit(2, 10000)).not.toThrow();
  });

  it("fails closed in production without explicit external protection configuration", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ASK_EXTERNAL_RATE_LIMIT_ENABLED", "");
    expect(() => enforceRequestLimit()).toThrow(expect.objectContaining({ status: 503 }));
    vi.stubEnv("ASK_EXTERNAL_RATE_LIMIT_ENABLED", "true");
    expect(() => enforceRequestLimit()).not.toThrow();
  });

  it("validates local configuration without leaking values", () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const value of ["-1", "0", "1.5", "secret-value", "Infinity"]) {
      vi.stubEnv("ASK_LOCAL_RATE_LIMIT", value);
      expect(() => enforceRequestLimit()).toThrow("not configured correctly");
    }
  });

  it("shares a single local bucket across callers without accepting client identity", async () => {
    vi.resetModules();
    const { enforceRequestLimit: enforce } = await import("@/lib/ai/requestProtection");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ASK_LOCAL_RATE_LIMIT", "1");
    enforce();
    expect(() => enforce()).toThrow(expect.objectContaining({ status: 429 }));
  });

  it("counts UTF-8 bytes and ignores understated content lengths", async () => {
    await expect(readRequestJSON(request(JSON.stringify({ question: "é".repeat(MAX_REQUEST_BYTES / 2) }), { "content-length": "2" })))
      .rejects.toMatchObject({ status: 413 });
    await expect(readRequestJSON(request(" ".repeat(MAX_REQUEST_BYTES - 2) + "{}"))).resolves.toEqual({});
  });

  it("rejects oversized chunked input and cancels the reader", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_REQUEST_BYTES));
        controller.enqueue(new Uint8Array(1));
      }, cancel,
    });
    const req = { headers: new Headers(), body: stream } as Request;
    await expect(readRequestJSON(req)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(["not json", "", "{ incomplete"])("rejects invalid JSON", async (body) => {
    await expect(readRequestJSON(request(body))).rejects.toMatchObject({ status: 400 });
  });
});
