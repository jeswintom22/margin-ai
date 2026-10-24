/**
 * Answer-generation service: validates the request, prompts the configured
 * provider for a structured answer, and returns a validated AnswerDocument.
 *
 * The provider may support JSON-schema response formats or only plain text;
 * both paths end at the same Zod validation, so the client always receives a
 * structurally valid document or a controlled error — never a partially parsed
 * answer.
 *
 * Server-only: calls the LLM client. Do not import from client code.
 */

import { z } from "zod";
import { chatCompletion, LLMError, type LLMConfig } from "./llm";
import {
  answerDocumentSchema,
  ANSWER_BLOCK_TYPES,
  LIMITS,
  type AnswerDocument,
} from "./answerSchema";

const SYSTEM_PROMPT = `You are a study assistant inside a handwritten notebook app.
Answer the user's question as a single JSON object — never markdown, never prose outside the JSON.

The object must have this shape:
{
  "schemaVersion": 1,
  "title": "short answer title",
  "blocks": [ { "id": "b1", "type": "...", ... } ],
  "summary": "optional one-line takeaway",
  "followUpSuggestions": ["optional follow-up question"]
}

Each block needs a unique "id" (b1, b2, ...) and a "type" from: ${ANSWER_BLOCK_TYPES.join(", ")}.

Block fields:
- paragraph: text (inline math may be written as $...$)
- heading: level 1-3, text
- list: style "bulleted"|"numbered", items: [{text, children?}] (max 3 levels)
- callout: kind "note"|"tip"|"warning", text
- math: latex, display true — use for display equations
- derivation: steps: [{latex, note?}] — step-by-step math
- definition: term, definition
- code: language, code, explanation?
- steps: title?, items: [string] — ordered implementation steps
- table: headers: [string], rows: [[string]]
- diagram: title?, primitives on a normalized 0-100 canvas: line/arrow {from:{x,y},to:{x,y}}, box/ellipse {x,y,w,h,label?}, label {x,y,text}
- annotation: text, targetBlockId? — a note about another block

Keep it concise. Do not claim results are verified or code is tested.`;

/** Loose structural hint sent to providers supporting response_format. */
const SCHEMA_HINT = {
  name: "answer_document",
  schema: {
    type: "object",
    required: ["schemaVersion", "title", "blocks"],
    properties: {
      schemaVersion: { type: "integer" },
      title: { type: "string" },
      blocks: { type: "array", items: { type: "object" } },
      summary: { type: "string" },
      followUpSuggestions: { type: "array", items: { type: "string" } },
    },
  } satisfies Record<string, unknown>,
};

/** One extra attempt after a formatting failure — never a loop. */
const MAX_ATTEMPTS = 2;

export class AnswerError extends LLMError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = "AnswerError";
  }
}

export function normalizeQuestion(question: string): string {
  return question.trim().replace(/\n{3,}/g, "\n\n");
}

/**
 * Extract a JSON object from model output. Accepts clean JSON, ```json fenced
 * blocks, or prose with a JSON object embedded; returns undefined if no object
 * parses.
 */
export function extractJSONObject(content: string): unknown {
  if (content.length > LIMITS.rawResponseChars) return undefined;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const candidates = [
    content.trim(),
    ...(fenced ? [fenced[1].trim()] : []),
  ];
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(content.slice(start, end + 1));
  for (const c of candidates) {
    try {
      const parsed: unknown = JSON.parse(c);
      if (parsed && typeof parsed === "object") return parsed;
    } catch { /* try next candidate */ }
  }
  return undefined;
}

/**
 * Generate a structured answer. Throws LLMError for provider failures and
 * AnswerError (502) when the model cannot produce a valid document.
 */
export async function generateAnswer(
  rawQuestion: string,
  config: LLMConfig,
  fetchImpl: typeof fetch = fetch
): Promise<AnswerDocument> {
  const question = normalizeQuestion(rawQuestion);
  let lastValidation: string | null = null;
  let sawUnsupportedSchema = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Attempt 1 uses json_schema. Attempt 2 falls back to the widely-supported
    // json_object mode — which also covers providers that ignore the format
    // request entirely. A schema-validation failure on attempt 1 triggers the
    // same fallback once, bounded by MAX_ATTEMPTS.
    const useSchemaMode = attempt === 1 && !sawUnsupportedSchema;
    try {
      const { content, model } = await chatCompletion(
        config,
        {
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: question },
          ],
          responseFormat: useSchemaMode ? "json_schema" : "json_object",
          jsonSchema: SCHEMA_HINT,
        },
        fetchImpl
      );

      const data = extractJSONObject(content);
      if (data === undefined) {
        lastValidation = "response was not valid JSON";
        continue;
      }
      const parsed = answerDocumentSchema.safeParse(data);
      if (!parsed.success) {
        lastValidation = `response failed validation: ${summarizeIssues(parsed.error)}`;
        continue;
      }
      return finalizeDocument(parsed.data, model);
    } catch (e) {
      // Provider rejected the request format itself → retry in json_object mode.
      if (e instanceof LLMError && e.providerStatus === 400 && attempt === 1) {
        sawUnsupportedSchema = true;
        continue;
      }
      throw e;
    }
  }

  throw new AnswerError(
    `The assistant could not produce a valid structured answer (${lastValidation ?? "empty response"}). Try rephrasing the question.`,
    502
  );
}

function summarizeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "root"}: ${i.code}`)
    .join("; ")
    .slice(0, 200);
}

/**
 * Assign stable sequential block ids and attach trustworthy metadata.
 * Model-supplied ids are normalized to b1..bn so duplicates or weird values
 * can never collide or confuse block references.
 */
function finalizeDocument(doc: AnswerDocument, model?: string): AnswerDocument {
  const blocks = doc.blocks.map((b, i) => ({ ...b, id: `b${i + 1}` }));
  const validIds = new Set(blocks.map((b) => b.id));
  const warnings: string[] = [...(doc.metadata?.warnings ?? [])];
  // Annotation targets are rewritten to the normalized ids only if they match;
  // otherwise the reference is dropped.
  for (const b of blocks) {
    if (b.type === "annotation" && b.targetBlockId && !validIds.has(b.targetBlockId)) {
      const m = /^b?(\d+)$/.exec(b.targetBlockId);
      const n = m ? Number(m[1]) : NaN;
      b.targetBlockId = n >= 1 && n <= blocks.length ? `b${n}` : undefined;
    }
  }
  return {
    ...doc,
    blocks,
    metadata: {
      ...doc.metadata,
      generatedAt: Date.now(),
      ...(model ? { model } : {}),
      warnings: warnings.length ? warnings : undefined,
      verificationStatus: "unverified",
    },
  };
}
