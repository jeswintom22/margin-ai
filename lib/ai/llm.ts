import { mockCompletion } from "./mockLLM";
/**
 * Minimal server-side client for one OpenAI-compatible chat completions API.
 * Server-only: reads the API key from the environment. Never import from client code.
 */

export type LLMConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /** Optional per-capability models (fall back to `model`). */
  fastModel?: string;
  visionModel?: string;
  reasoningModel?: string;
  /** Dev/test-only deterministic provider (LLM_MOCK=true outside production). */
  mock?: boolean;
};

/** Error with an HTTP status suitable for returning to the browser. */
export class LLMError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Raw upstream status, when the failure came from the provider. Never send to the client. */
    readonly providerStatus?: number
  ) {
    super(message);
    this.name = "LLMError";
  }
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const SYSTEM_PROMPT =
  "You are a concise, helpful study assistant inside a handwritten notebook app. " +
  "Answer clearly in plain text. Keep answers short unless the user asks for detail.";

export function readLLMConfig(env: Record<string, string | undefined> = process.env): LLMConfig {
  if (env.LLM_MOCK === "true" && env.NODE_ENV !== "production") {
    return { apiKey: "mock", baseUrl: "mock:", model: "mock", visionModel: "mock-vision", reasoningModel: "mock-reasoning", timeoutMs: 30000, mock: true };
  }
  const apiKey = env.LLM_API_KEY?.trim();
  if (!apiKey) throw new LLMError("The assistant is not configured: LLM_API_KEY is missing", 503);
  const timeoutMs = env.LLM_TIMEOUT_MS ? Number(env.LLM_TIMEOUT_MS) : 30000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000) {
    throw new LLMError("The assistant timeout is not configured correctly", 503);
  }
  return {
    apiKey,
    baseUrl: (env.LLM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: env.LLM_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs,
    fastModel: env.LLM_FAST_MODEL?.trim() || undefined,
    visionModel: env.LLM_VISION_MODEL?.trim() || undefined,
    reasoningModel: env.LLM_REASONING_MODEL?.trim() || undefined,
  };
}

/** Multimodal user content: text + image parts (OpenAI-compatible shape). */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" } };

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };

export type ChatOptions = {
  messages: ChatMessage[];
  /** Model override from the router; defaults to config.model. */
  model?: string;
  /**
   * Provider-side response format. `json_schema` asks for structured output;
   * `json_object` is the widely-compatible JSON mode fallback.
   */
  responseFormat?: "json_schema" | "json_object";
  /** A JSON Schema document sent with json_schema mode (non-strict). */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
};

export type ChatResult = { content: string; model?: string };

/**
 * One chat completion call. Returns the message content; throws LLMError for
 * transport, timeout, and provider failures. Provider error bodies are never
 * forwarded — they can echo request details — but `providerStatus` is recorded
 * so callers can distinguish "unsupported feature" (4xx) from server faults.
 */
export async function chatCompletion(
  config: LLMConfig,
  opts: ChatOptions,
  fetchImpl: typeof fetch = fetch
): Promise<ChatResult> {
  if (config.mock) return mockCompletion(opts);
  let responseFormat: Record<string, unknown> | undefined;
  if (opts.responseFormat === "json_schema") {
    responseFormat = {
      type: "json_schema",
      json_schema: {
        name: opts.jsonSchema?.name ?? "answer",
        strict: false,
        schema: opts.jsonSchema?.schema ?? { type: "object" },
      },
    };
  } else if (opts.responseFormat === "json_object") {
    responseFormat = { type: "json_object" };
  }

  let res: Response;
  try {
    res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model ?? config.model,
        messages: opts.messages,
        ...(responseFormat ? { response_format: responseFormat } : {}),
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))
      throw new LLMError("The AI provider took too long to respond", 504);
    throw new LLMError("Could not reach the AI provider", 502);
  }

  if (!res.ok) {
    // Don't forward the provider's error body; it can echo request details.
    if (res.status === 401 || res.status === 403)
      throw new LLMError("The AI provider rejected the API key", 502, res.status);
    if (res.status === 429)
      throw new LLMError("The AI provider is rate limiting requests; try again shortly", 429, 429);
    if (res.status >= 400 && res.status < 500)
      throw new LLMError("The AI provider rejected the request", 502, res.status);
    throw new LLMError(`The AI provider returned an error (HTTP ${res.status})`, 502, res.status);
  }

  const data: unknown = await res.json().catch((error: unknown) => {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new LLMError("The AI provider took too long to respond", 504);
    }
    return null;
  });
  const parsed = data as { choices?: { message?: { content?: unknown } }[]; model?: unknown } | null;
  const content = extractAnswer(data);
  if (!content) throw new LLMError("The AI provider returned an empty or unexpected response", 502);
  const model = typeof parsed?.model === "string" ? parsed.model.slice(0, 100) : undefined;
  return { content, model };
}

/** Plain-text question answering (kept for simple callers). */
export async function askLLM(
  question: string,
  config: LLMConfig,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const { content } = await chatCompletion(
    config,
    {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: question },
      ],
    },
    fetchImpl
  );
  return content;
}

function extractAnswer(data: unknown): string | null {
  const choices = (data as { choices?: { message?: { content?: unknown } }[] } | null)?.choices;
  const content = Array.isArray(choices) ? choices[0]?.message?.content : undefined;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}
