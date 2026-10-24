import { z } from "zod";

/**
 * Typed, validated snapshot of notebook content sent to the assistant.
 * Built client-side from the live document, re-validated server-side.
 * Strokes are referenced as ink (ids + bounds) — there is no transcription,
 * so they are never presented as text.
 */

export const CONTEXT_LIMITS = {
  items: 24,
  itemText: 3000,
  itemCount: 40,
  totalChars: 12_000,
  strokeIds: 200,
  id: 64,
} as const;

const bounds = z.object({
  minX: z.number().finite(),
  minY: z.number().finite(),
  maxX: z.number().finite(),
  maxY: z.number().finite(),
});

/** A short text fragment extracted from the document, with its source. */
const contextItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pageText"),
    pageId: z.string().max(CONTEXT_LIMITS.id),
    pageIndex: z.number().int().min(0),
    /** AI-layer element text (positioned content), if present. */
    aiTexts: z.array(z.string().max(CONTEXT_LIMITS.itemText)).max(CONTEXT_LIMITS.itemCount),
    /** Ink summary: stroke count + bounds; no invented transcription. */
    ink: z.object({ strokeIds: z.array(z.string().max(CONTEXT_LIMITS.id)).max(CONTEXT_LIMITS.strokeIds), bounds }),
  }),
  z.object({
    kind: z.literal("selection"),
    pageId: z.string().max(CONTEXT_LIMITS.id),
    pageIndex: z.number().int().min(0),
    strokeIds: z.array(z.string().max(CONTEXT_LIMITS.id)).max(CONTEXT_LIMITS.strokeIds),
    bounds,
  }),
  z.object({
    kind: z.literal("neighborPage"),
    pageId: z.string().max(CONTEXT_LIMITS.id),
    pageIndex: z.number().int().min(0),
    aiTexts: z.array(z.string().max(CONTEXT_LIMITS.itemText)).max(CONTEXT_LIMITS.itemCount),
    inkStrokeCount: z.number().int().min(0),
  }),
]);

export type ContextItem = z.infer<typeof contextItemSchema>;

export const notebookContextSchema = z.object({
  notebookId: z.string().max(CONTEXT_LIMITS.id),
  activePageId: z.string().max(CONTEXT_LIMITS.id),
  items: z.array(contextItemSchema).min(1).max(CONTEXT_LIMITS.items),
});

export type NotebookContext = z.infer<typeof notebookContextSchema>;

/** Total characters across all text payloads — the server-enforced cap. */
export function contextChars(ctx: NotebookContext): number {
  let n = 0;
  for (const i of ctx.items) {
    if ("aiTexts" in i) n += i.aiTexts.reduce((a, t) => a + t.length, 0);
  }
  return n;
}
