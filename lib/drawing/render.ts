import type { NotebookPage, PageElement, PaperStyle, Stroke } from "@/lib/document/types";
import { drawStrokeText } from "@/lib/drawing/strokeFont";

// ---- page backgrounds (imported PDF pages) ----

const bgImages = new Map<string, HTMLImageElement>();
const bgListeners = new Set<() => void>();

/** Subscribe to "a background image finished decoding" (repaint trigger). */
export function onBackgroundLoaded(fn: () => void): () => void {
  bgListeners.add(fn);
  return () => bgListeners.delete(fn);
}

/** Decoded image for a background, or null while it is still loading. */
export function backgroundImage(dataUrl: string): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  let img = bgImages.get(dataUrl);
  if (!img) {
    img = new Image();
    img.onload = () => bgListeners.forEach((f) => f());
    img.src = dataUrl;
    bgImages.set(dataUrl, img);
    if (bgImages.size > 60) bgImages.delete(bgImages.keys().next().value as string); // bound memory
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** Draw the locked background scaled to the page (under every layer). */
export function drawBackground(ctx: CanvasRenderingContext2D, page: NotebookPage) {
  if (!page.background) return;
  const img = backgroundImage(page.background.dataUrl);
  if (img) ctx.drawImage(img, 0, 0, page.width, page.height);
}

export const HAND_FONT = "Kalam, 'Segoe Script', 'Comic Sans MS', cursive";
export const MONO_FONT = "'Cascadia Mono', Consolas, 'Courier New', monospace";

export function drawElement(ctx: CanvasRenderingContext2D, el: PageElement) {
  if (el.type === "text") {
    if (el.font === "hand") {
      // AI handwriting: real pen strokes with per-element jitter.
      drawStrokeText(ctx, el.text, el.x, el.y, el.size, {
        color: el.color ?? "#1d4ed8",
        bold: el.bold,
        seed: el.id,
        fallbackFont: HAND_FONT,
      });
      return;
    }
    ctx.fillStyle = el.color ?? "#1d4ed8";
    ctx.font = `${el.bold ? "700 " : ""}${el.size}px ${MONO_FONT}`;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(el.text, el.x, el.y);
  } else if (el.type === "line") {
    ctx.strokeStyle = el.color ?? "#334155";
    ctx.lineWidth = el.width ?? 1.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(el.x1, el.y1);
    ctx.lineTo(el.x2, el.y2);
    ctx.stroke();
  } else {
    if (el.fill) {
      ctx.fillStyle = el.fill;
      ctx.fillRect(el.x, el.y, el.w, el.h);
    }
    if (el.stroke) {
      ctx.strokeStyle = el.stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(el.x, el.y, el.w, el.h);
    }
  }
}

export const RULE_SPACING = 32;
export const GRID_SPACING = 32;
export const PAGE_BG = "#ffffff";
export const GUIDE_COLOR = "#d6dde8";

/**
 * Trace a stroke as a smoothed path of quadratic segments through midpoints.
 * When pressure data exists, each segment gets its own lineWidth, producing
 * natural tapering. Draws directly onto `ctx` (already scaled to page space).
 */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const pts = stroke.points;
  if (pts.length === 0) return;
  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = stroke.tool === "highlighter" ? 0.35 : 1;

  const w = (i: number) => {
    const p = pts[Math.min(i, pts.length - 1)].pressure;
    return stroke.width * (p == null ? 1 : 0.4 + 1.2 * p);
  };

  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, w(0) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    const midX = (prev.x + cur.x) / 2;
    const midY = (prev.y + cur.y) / 2;
    const endX = next ? (cur.x + next.x) / 2 : cur.x;
    const endY = next ? (cur.y + next.y) / 2 : cur.y;
    ctx.beginPath();
    ctx.lineWidth = Math.max(0.5, w(i));
    ctx.moveTo(midX, midY);
    ctx.quadraticCurveTo(cur.x, cur.y, endX, endY);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawPaper(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  style: PaperStyle
) {
  ctx.fillStyle = PAGE_BG;
  ctx.fillRect(0, 0, width, height);
  if (style === "blank") return;
  ctx.strokeStyle = GUIDE_COLOR;
  ctx.lineWidth = 1 / (ctx.getTransform().a || 1); // ~1 screen px
  ctx.beginPath();
  if (style === "ruled") {
    for (let y = RULE_SPACING * 2; y < height; y += RULE_SPACING) {
      ctx.moveTo(24, y);
      ctx.lineTo(width - 24, y);
    }
  } else {
    for (let y = GRID_SPACING; y < height; y += GRID_SPACING) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    for (let x = GRID_SPACING; x < width; x += GRID_SPACING) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
  }
  ctx.stroke();
}

/** Render a full page: paper + visible layers bottom-to-top. */
export function renderPage(
  ctx: CanvasRenderingContext2D,
  page: NotebookPage,
  inProgress?: Stroke | null
) {
  ctx.clearRect(0, 0, page.width, page.height);
  drawPaper(ctx, page.width, page.height, page.paperStyle);
  drawBackground(ctx, page);
  for (const layer of page.layers) {
    if (!layer.visible) continue;
    for (const e of layer.elements ?? []) drawElement(ctx, e);
    for (const s of layer.strokes) drawStroke(ctx, s);
  }
  if (inProgress) drawStroke(ctx, inProgress);
}
