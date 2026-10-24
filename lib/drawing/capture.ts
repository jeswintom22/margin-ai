import type { NotebookPage } from "@/lib/document/types";
import { strokeBounds } from "./geometry";
import { drawStroke, drawElement, drawBackground } from "./render";

/**
 * Render a bounded region of a page to a PNG data URL (client only).
 * Draws the page background (e.g. PDF) and every visible layer (user ink +
 * AI elements) over white paper —
 * the drawing engine is reused unchanged; nothing is mutated.
 */
export function captureRegionPNG(
  page: NotebookPage,
  strokeIds: string[],
  opts: { padding?: number; scale?: number; maxDim?: number; rect?: { x: number; y: number; w: number; h: number } } = {}
): { dataUrl: string; width: number; height: number } | null {
  const sel = new Set(strokeIds);
  const strokes = page.layers.flatMap((l) => l.strokes).filter((s) => sel.has(s.id));
  // With no strokes, an explicit rect still captures (whole-page / PDF-only).
  if (!strokes.length && !opts.rect) return null;

  const pad = opts.padding ?? 24;
  // Crop to the user's selection region (lasso/rect bounds) when provided,
  // so background content (e.g. a PDF problem) inside the loop is included.
  const src = opts.rect
    ? [{ minX: opts.rect.x, minY: opts.rect.y, maxX: opts.rect.x + opts.rect.w, maxY: opts.rect.y + opts.rect.h }]
    : strokes.map(strokeBounds);
  const b = src.reduce((a, c) => ({
    minX: Math.max(0, Math.min(a.minX, c.minX) - pad),
    minY: Math.max(0, Math.min(a.minY, c.minY) - pad),
    maxX: Math.min(page.width, Math.max(a.maxX, c.maxX) + pad),
    maxY: Math.min(page.height, Math.max(a.maxY, c.maxY) + pad),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  if (w <= 0 || h <= 0) return null;
  const maxDim = opts.maxDim ?? 1600;
  const scale = Math.min(opts.scale ?? 2, maxDim / w, maxDim / h);

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.translate(-b.minX, -b.minY);
  drawBackground(ctx, page); // include PDF content under the selection
  for (const layer of page.layers) {
    if (!layer.visible) continue;
    for (const e of layer.elements ?? []) drawElement(ctx, e);
    for (const s of layer.strokes) drawStroke(ctx, s);
  }
  return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}
