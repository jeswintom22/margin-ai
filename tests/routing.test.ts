import { describe, it, expect, vi } from "vitest";
import { resolveModel, readRoutes } from "@/lib/ai/routing";
import { parseImageInput } from "@/lib/ai/imageInput";
import { generateAnswer } from "@/lib/ai/answerService";
import type { LLMConfig } from "@/lib/ai/llm";
import { PNG_1PX, PNG_5000PX } from "./helpers/images";

const routes = { fast: "f", vision: "v", reasoning: "r" };

describe("model routing", () => {
  it("routes text to fast, images to vision, explicit capability wins", () => {
    expect(resolveModel(routes, { hasImage: false })).toEqual({ capability: "fast", model: "f" });
    expect(resolveModel(routes, { hasImage: true })).toEqual({ capability: "vision", model: "v" });
    expect(resolveModel(routes, { hasImage: false, capability: "reasoning" }).model).toBe("r");
    // image forces vision even if a weaker capability was requested
    expect(resolveModel(routes, { hasImage: true, capability: "fast" }).model).toBe("v");
  });

  it("falls back to the default model and fails clearly without vision config", () => {
    expect(readRoutes({}, "base")).toEqual({ fast: "base", vision: undefined, reasoning: undefined });
    expect(readRoutes({ LLM_VISION_MODEL: "vm" }, "base").vision).toBe("vm");
    expect(() => resolveModel({ fast: "f" }, { hasImage: true })).toThrowError(/LLM_VISION_MODEL/);
    expect(() => resolveModel({ fast: "f" }, { hasImage: false, capability: "reasoning" })).toThrowError(/LLM_REASONING_MODEL/);
  });
});

describe("parseImageInput", () => {
  it("accepts a valid PNG data URL", () => {
    const img = parseImageInput(`data:image/png;base64,${PNG_1PX}`);
    expect(img).toMatchObject({ mime: "image/png", width: 8, height: 8 });
  });
  it("rejects bad mime, oversize, and oversized dimensions", () => {
    expect(() => parseImageInput("data:image/gif;base64,AAAA")).toThrowError(/PNG or JPEG/);
    expect(() => parseImageInput(`data:image/png;base64,${"A".repeat(3_000_001)}`)).toThrowError(/too large/);
    expect(() => parseImageInput(`data:image/png;base64,${PNG_5000PX}`)).toThrowError(/dimensions/);
    expect(() => parseImageInput("nope")).toThrowError(/invalid/);
    expect(() => parseImageInput("data:image/png;base64,AAAA")).toThrowError(/could not be read/);
  });
});

describe("vision generation", () => {
  const config: LLMConfig = { apiKey: "k", baseUrl: "https://x/v1", model: "base", fastModel: "f", visionModel: "v", timeoutMs: 1000 };
  const docJson = JSON.stringify({ schemaVersion: 1, title: "T", blocks: [{ id: "b", type: "paragraph", text: "ok" }] });

  it("sends multimodal content to the vision model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: docJson } }] }), { status: 200 }));
    const doc = await generateAnswer("read this", config, fetchMock, undefined, { image: `data:image/png;base64,${PNG_1PX}` });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("v");
    const parts = body.messages.at(-1).content;
    expect(parts.map((p: { type: string }) => p.type)).toEqual(["text", "image_url"]);
    expect(doc.metadata?.warnings?.some((w) => w.includes("capability: vision"))).toBe(true);
  });

  it("uses the fast model for plain questions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: docJson } }] }), { status: 200 }));
    await generateAnswer("q", config, fetchMock);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("f");
  });
});
