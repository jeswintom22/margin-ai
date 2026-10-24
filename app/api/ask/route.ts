import { readLLMConfig, LLMError } from "@/lib/ai/llm";
import { generateAnswer } from "@/lib/ai/answerService";
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
    const context = (body as { context?: unknown } | null)?.context;
    const answer = await generateAnswer((question as string).trim(), readLLMConfig(), fetch, context);
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
