import type { Notebook, NotebookPage } from "@/lib/document/types";
import { strokeBounds } from "@/lib/drawing/geometry";
import { CONTEXT_LIMITS, type ContextItem, type NotebookContext } from "./contextSchema";

/**
 * Deterministic, LLM-free context builder. Priority policy:
 * 1. If the user selected strokes, emit a `selection` item (ids + bounds only).
 * 2. Always include the active page: AI-layer text (readable) plus ink summary
 *    (stroke ids + bounds — strokes are NOT transcribed).
 * 3. Include immediate neighbors (previous/next page) for continuity.
 * Text is trimmed to fit CONTEXT_LIMITS; item order follows page order.
 */
export function buildNotebookContext(
  nb: Notebook,
  opts: { pageId: string; selectedStrokeIds?: string[] }
): NotebookContext | null {
  const idx = nb.pages.findIndex((p) => p.id === opts.pageId);
  if (idx < 0) return null;
  const page = nb.pages[idx];
  const items: ContextItem[] = [];

  const sel = opts.selectedStrokeIds?.filter(Boolean) ?? [];
  if (sel.length) {
    const strokes = page.layers.flatMap((l) => l.strokes).filter((s) => sel.includes(s.id));
    if (strokes.length) {
      const b = strokes.map(strokeBounds).reduce((a, c) => ({
        minX: Math.min(a.minX, c.minX), minY: Math.min(a.minY, c.minY),
        maxX: Math.max(a.maxX, c.maxX), maxY: Math.max(a.maxY, c.maxY),
      }));
      items.push({
        kind: "selection",
        pageId: page.id, pageIndex: idx,
        strokeIds: strokes.map((s) => s.id).slice(0, CONTEXT_LIMITS.strokeIds),
        bounds: b,
      });
    }
  }

  items.push(pageItem(page, idx));

  for (const di of [-1, 1]) {
    const j = idx + di;
    if (j >= 0 && j < nb.pages.length) items.push(neighborItem(nb.pages[j], j));
  }

  return { notebookId: nb.id, activePageId: page.id, items: items.slice(0, CONTEXT_LIMITS.items) };
}

function aiTextsOf(page: NotebookPage): string[] {
  const out: string[] = [];
  for (const l of page.layers) {
    if (l.author !== "ai" || !l.visible) continue;
    for (const e of l.elements) if (e.type === "text") out.push(e.text);
  }
  return out.slice(0, CONTEXT_LIMITS.itemCount).map((t) => t.slice(0, CONTEXT_LIMITS.itemText));
}

function inkOf(page: NotebookPage) {
  const strokes = page.layers.filter((l) => l.author === "user").flatMap((l) => l.strokes);
  if (!strokes.length) return { strokeIds: [] as string[], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  const b = strokes.map(strokeBounds).reduce((a, c) => ({
    minX: Math.min(a.minX, c.minX), minY: Math.min(a.minY, c.minY),
    maxX: Math.max(a.maxX, c.maxX), maxY: Math.max(a.maxY, c.maxY),
  }));
  return { strokeIds: strokes.map((s) => s.id).slice(0, CONTEXT_LIMITS.strokeIds), bounds: b };
}

function pageItem(page: NotebookPage, index: number): ContextItem {
  return { kind: "pageText", pageId: page.id, pageIndex: index, aiTexts: aiTextsOf(page), ink: inkOf(page) };
}

function neighborItem(page: NotebookPage, index: number): ContextItem {
  return {
    kind: "neighborPage", pageId: page.id, pageIndex: index,
    aiTexts: aiTextsOf(page),
    inkStrokeCount: page.layers.filter((l) => l.author === "user").flatMap((l) => l.strokes).length,
  };
}
