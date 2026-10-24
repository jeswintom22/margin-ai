import { readLLMConfig, LLMError } from "@/lib/ai/llm";
import { TUTOR_MODES, generateAnswer } from "@/lib/ai/answerService";
import { validateQuestion, type AskResponse } from "@/lib/ai/types";
import { enforceRequestLimit, readRequestJSON, RequestError } from "@/lib/ai/requestProtection";

/** POST /api/ask — { question } → { answer: AnswerDocument } | { error } */
export async function POST(request: Request) {
  try {
    enforceRequestLimit();
    const body = await readRequestJSON(request);
    const question = (body as { question?: unknown } | null)?.question;
    const invalid = validateQuestion(question);
    if (invalid) return json({ error: invalid }, 400);
    const b = body as { context?: unknown; image?: unknown; capability?: unknown; mode?: unknown; lines?: unknown } | null;
    const mode = TUTOR_MODES.find((m) => m === b?.mode);
    if (b?.mode !== undefined && !mode) throw new RequestError("Unknown tutor mode", 400);
    const lines = Array.isArray(b?.lines) && b.lines.every((l) => typeof l === "string") ? (b.lines as string[]) : undefined;
    if (b?.lines !== undefined && !lines) throw new RequestError("lines must be an array of strings", 400);
    const capability =
      b?.capability === "fast" || b?.capability === "vision" || b?.capability === "reasoning"
        ? b.capability
        : undefined;
    const answer = await generateAnswer(
      (question as string).trim(),
      readLLMConfig(),
      fetch,
      b?.context,
      { image: b?.image, capability, mode, lines }
    );
    return json({ answer }, 200);
  } catch (e) {
    if (e instanceof RequestError) return json({ error: e.message }, e.status, e.retryAfter);
    if (e instanceof LLMError) return json({ error: e.message }, e.status);
    return json({ error: "Unexpected server error" }, 500);
  }
}

function json(body: AskResponse, status: number, retryAfter?: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) },
  });
}
