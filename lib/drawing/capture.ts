import type { NotebookPage } from "@/lib/document/types";
import { strokeBounds } from "./geometry";
import { drawStroke, drawElement } from "./render";

/**
 * Render a bounded region of a page to a PNG data URL (client only).
 * Draws every visible layer (user ink + AI elements) over white paper —
 * the drawing engine is reused unchanged; nothing is mutated.
 */
export function captureRegionPNG(
  page: NotebookPage,
  strokeIds: string[],
  opts: { padding?: number; scale?: number; maxDim?: number } = {}
): { dataUrl: string; width: number; height: number } | null {
  const sel = new Set(strokeIds);
  const strokes = page.layers.flatMap((l) => l.strokes).filter((s) => sel.has(s.id));
  if (!strokes.length) return null;

  const pad = opts.padding ?? 24;
  const b = strokes.map(strokeBounds).reduce((a, c) => ({
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
  for (const layer of page.layers) {
    if (!layer.visible) continue;
    for (const e of layer.elements ?? []) drawElement(ctx, e);
    for (const s of layer.strokes) drawStroke(ctx, s);
  }
  return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}
