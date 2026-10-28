import type { Element, LineStyle, Page, Stroke, TextEl } from "@/lib/xdoc/types";
import { drawStrokeText } from "@/lib/drawing/strokeFont";
import { drawBackground, paperColor } from "./background";
import type { AssetCache } from "./assets";

/** v4 text: (x, y) is the top-left of the first line; baseline is y + size·ASCENT. */
export const TEXT_ASCENT = 0.8;
export const TEXT_LINE_HEIGHT = 1.25;
export const HAND_FALLBACK_FONT = "Kalam, 'Segoe Script', 'Comic Sans MS', cursive";
export const HIGHLIGHTER_ALPHA = 0.4;

export type RenderOptions = {
  assets?: AssetCache | null;
  drawPdf?: (ctx: CanvasRenderingContext2D, page: Page) => boolean;
  /** Element ids to skip (e.g. while being dragged in a selection). */
  hidden?: ReadonlySet<string>;
};

function dashFor(style: LineStyle | undefined, w: number): number[] {
  switch (style) {
    case "dash":
      return [w * 4, w * 3];
    case "dashdot":
      return [w * 4, w * 2.5, w * 0.5, w * 2.5];
    case "dot":
      return [w * 0.5, w * 2.5];
    default:
      return [];
  }
}

/** Trace a smoothed path (quadratic curves through midpoints). */
function tracePath(ctx: CanvasRenderingContext2D, s: Stroke) {
  const pts = s.points;
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const c = pts[i], n = pts[i + 1];
    ctx.quadraticCurveTo(c.x, c.y, (c.x + n.x) / 2, (c.y + n.y) / 2);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, paper: string) {
  const pts = s.points;
  if (!pts.length) return;
  ctx.save();
  const color = s.tool === "whiteout" ? paper : s.color;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = s.tool === "highlighter" ? "butt" : "round";
  ctx.lineJoin = "round";
  if (s.tool === "highlighter") ctx.globalAlpha = HIGHLIGHTER_ALPHA;
  if (s.fill && pts.length > 2) {
    ctx.save();
    ctx.fillStyle = s.fill;
    if (s.tool === "highlighter") ctx.globalAlpha = HIGHLIGHTER_ALPHA;
    ctx.beginPath();
    tracePath(ctx, s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, (s.widths?.[0] ?? s.width) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.setLineDash(dashFor(s.lineStyle, s.width));
  if (!s.widths || s.tool === "highlighter") {
    // Fast path: one path, one stroke call (highlighter must not overlap itself).
    ctx.lineWidth = s.width;
    ctx.beginPath();
    tracePath(ctx, s);
    ctx.stroke();
  } else {
    // Pressure: one quadratic segment per point with its own width.
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], c = pts[i], n = pts[i + 1];
      ctx.lineWidth = Math.max(0.2, s.widths[i]);
      ctx.beginPath();
      ctx.moveTo((p.x + c.x) / 2, (p.y + c.y) / 2);
      if (n) ctx.quadraticCurveTo(c.x, c.y, (c.x + n.x) / 2, (c.y + n.y) / 2);
      else ctx.lineTo(c.x, c.y);
      if (i === 1) {
        ctx.moveTo(p.x, p.y);
        ctx.lineTo((p.x + c.x) / 2, (p.y + c.y) / 2);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawText(ctx: CanvasRenderingContext2D, t: TextEl) {
  const lines = t.text.split("\n");
  if (t.font === "margin-hand") {
    lines.forEach((line, i) => {
      drawStrokeText(ctx, line, t.x, t.y + t.size * TEXT_ASCENT + i * t.size * TEXT_LINE_HEIGHT, t.size, {
        color: t.color,
        seed: `${t.id}:${i}`,
        fallbackFont: HAND_FALLBACK_FONT,
      });
    });
    return;
  }
  ctx.save();
  ctx.fillStyle = t.color;
  ctx.font = `${t.size}px ${t.font}`;
  ctx.textBaseline = "alphabetic";
  lines.forEach((line, i) => ctx.fillText(line, t.x, t.y + t.size * TEXT_ASCENT + i * t.size * TEXT_LINE_HEIGHT));
  ctx.restore();
}

export function drawElement(ctx: CanvasRenderingContext2D, e: Element, paper: string, assets?: AssetCache | null) {
  switch (e.type) {
    case "stroke":
      drawStroke(ctx, e, paper);
      break;
    case "text":
      drawText(ctx, e);
      break;
    case "image": {
      const img = assets?.blobImage(e.blobId);
      if (img) ctx.drawImage(img, e.x, e.y, e.w, e.h);
      else placeholder(ctx, e.x, e.y, e.w, e.h);
      break;
    }
    case "tex": {
      const img = assets?.svgImage(e.svg);
      if (img) ctx.drawImage(img, e.x, e.y, e.w, e.h);
      else placeholder(ctx, e.x, e.y, e.w, e.h);
      break;
    }
  }
}

function placeholder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.fillStyle = "rgba(148,163,184,0.15)";
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** Background + every visible layer, bottom to top, in page space. */
export function renderPage(ctx: CanvasRenderingContext2D, page: Page, opts: RenderOptions = {}) {
  drawBackground(ctx, page, opts.assets, opts.drawPdf);
  const paper = paperColor(page);
  for (const layer of page.layers) {
    if (!layer.visible) continue;
    for (const e of layer.elements) if (!opts.hidden?.has(e.id)) drawElement(ctx, e, paper, opts.assets);
  }
}
