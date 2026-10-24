/**
 * Minimal server-side client for one OpenAI-compatible chat completions API.
 * Server-only: reads the API key from the environment. Never import from client code.
 */

export type LLMConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
};

/** Error with an HTTP status suitable for returning to the browser. */
export class LLMError extends Error {
  constructor(message: string, readonly status: number) {
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
  const apiKey = env.LLM_API_KEY?.trim();
  if (!apiKey) throw new LLMError("The assistant is not configured: LLM_API_KEY is missing", 503);
  return {
    apiKey,
    baseUrl: (env.LLM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: env.LLM_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: Number(env.LLM_TIMEOUT_MS) || 30000,
  };
}

export async function askLLM(
  question: string,
  config: LLMConfig,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: question },
        ],
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
      throw new LLMError("The AI provider rejected the API key", 502);
    if (res.status === 429) throw new LLMError("The AI provider is rate limiting requests; try again shortly", 429);
    throw new LLMError(`The AI provider returned an error (HTTP ${res.status})`, 502);
  }

  const data: unknown = await res.json().catch(() => null);
  const answer = extractAnswer(data);
  if (!answer) throw new LLMError("The AI provider returned an empty or unexpected response", 502);
  return answer;
}

function extractAnswer(data: unknown): string | null {
  const choices = (data as { choices?: { message?: { content?: unknown } }[] } | null)?.choices;
  const content = Array.isArray(choices) ? choices[0]?.message?.content : undefined;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}
