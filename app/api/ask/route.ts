import { askLLM, readLLMConfig, LLMError } from "@/lib/ai/llm";
import { validateQuestion, type AskResponse } from "@/lib/ai/types";

/** POST /api/ask — { question } → { answer } | { error } */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const question = (body as { question?: unknown } | null)?.question;
  const invalid = validateQuestion(question);
  if (invalid) return json({ error: invalid }, 400);

  try {
    const answer = await askLLM((question as string).trim(), readLLMConfig());
    return json({ answer }, 200);
  } catch (e) {
    if (e instanceof LLMError) return json({ error: e.message }, e.status);
    console.error("Unexpected /api/ask failure", e);
    return json({ error: "Unexpected server error" }, 500);
  }
}

function json(body: AskResponse, status: number) {
  return Response.json(body, { status });
}
