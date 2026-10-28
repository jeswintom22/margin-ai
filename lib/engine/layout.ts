import type { Point } from "@/lib/xdoc/types";
import { PX_PER_PT } from "@/lib/xdoc/units";

/**
 * Page placement in the scrollable workspace (CSS px). `scale` is CSS px per
 * point, so zoom 100% means scale = 96/72.
 */
export type LayoutMode = "vertical" | "horizontal" | "dual";
export type PageBox = { x: number; y: number; w: number; h: number };
export type Layout = { boxes: PageBox[]; width: number; height: number; scale: number };

export const PAGE_GAP = 24;
export const ZOOM_LIMITS = { min: 0.1, max: 8 } as const; // relative to 100%

export const zoomToScale = (zoom: number) => zoom * PX_PER_PT;
export const scaleToZoom = (scale: number) => scale / PX_PER_PT;

type Size = { width: number; height: number };

export function computeLayout(pages: readonly Size[], mode: LayoutMode, scale: number, viewportWidth: number): Layout {
  const boxes: PageBox[] = [];
  const g = PAGE_GAP;
  if (mode === "horizontal") {
    let x = g;
    const maxH = Math.max(...pages.map((p) => p.height)) * scale;
    for (const p of pages) {
      const w = p.width * scale, h = p.height * scale;
      boxes.push({ x, y: g + (maxH - h) / 2, w, h });
      x += w + g;
    }
    return { boxes, width: x, height: maxH + 2 * g, scale };
  }
  const perRow = mode === "dual" ? 2 : 1;
  const rows: Size[][] = [];
  for (let i = 0; i < pages.length; i += perRow) rows.push(pages.slice(i, i + perRow) as Size[]);
  const rowWidth = (r: Size[]) => r.reduce((s, p) => s + p.width * scale, 0) + g * (r.length - 1);
  const contentW = Math.max(...rows.map(rowWidth)) + 2 * g;
  const width = Math.max(contentW, viewportWidth);
  let y = g;
  for (const r of rows) {
    const rw = rowWidth(r);
    let x = (width - rw) / 2;
    const rowH = Math.max(...r.map((p) => p.height * scale));
    for (const p of r) {
      const w = p.width * scale, h = p.height * scale;
      boxes.push({ x, y, w, h });
      x += w + g;
    }
    y += rowH + g;
  }
  return { boxes, width, height: y, scale };
}

/** Scale that fits the widest page (or row) into the viewport width. */
export function fitWidthScale(pages: readonly Size[], mode: LayoutMode, viewportWidth: number): number {
  const maxW = Math.max(...pages.map((p) => p.width)) * (mode === "dual" ? 2 : 1);
  const gaps = PAGE_GAP * (mode === "dual" ? 3 : 2);
  return Math.max(0.05, (viewportWidth - gaps) / maxW);
}

/** Scale that fits a whole page into the viewport. */
export function fitPageScale(page: Size, viewportWidth: number, viewportHeight: number, mode: LayoutMode = "vertical"): number {
  const w = page.width * (mode === "dual" ? 2 : 1);
  const sx = (viewportWidth - PAGE_GAP * (mode === "dual" ? 3 : 2)) / w;
  const sy = (viewportHeight - PAGE_GAP * 2) / page.height;
  return Math.max(0.05, Math.min(sx, sy));
}

export function clampScale(scale: number): number {
  return Math.min(zoomToScale(ZOOM_LIMITS.max), Math.max(zoomToScale(ZOOM_LIMITS.min), scale));
}

export type Viewport = { left: number; top: number; width: number; height: number };

/** Indices of pages intersecting the viewport expanded by `margin` px. */
export function visiblePages(layout: Layout, vp: Viewport, margin = 0): number[] {
  const out: number[] = [];
  const l = vp.left - margin, t = vp.top - margin, r = vp.left + vp.width + margin, b = vp.top + vp.height + margin;
  layout.boxes.forEach((p, i) => {
    if (p.x + p.w >= l && p.x <= r && p.y + p.h >= t && p.y <= b) out.push(i);
  });
  return out;
}

/** The page whose box covers the viewport center most (current page). */
export function centerPage(layout: Layout, vp: Viewport): number {
  const cx = vp.left + vp.width / 2, cy = vp.top + vp.height / 2;
  let best = 0, bestD = Infinity;
  layout.boxes.forEach((p, i) => {
    const dx = Math.max(p.x - cx, 0, cx - (p.x + p.w));
    const dy = Math.max(p.y - cy, 0, cy - (p.y + p.h));
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/** Page under a content-space point (px), or -1. `slack` extends each box. */
export function pageAt(layout: Layout, x: number, y: number, slack = 0): number {
  return layout.boxes.findIndex((p) => x >= p.x - slack && x <= p.x + p.w + slack && y >= p.y - slack && y <= p.y + p.h + slack);
}

/** Content px → page point. */
export function toPagePoint(layout: Layout, pageIndex: number, x: number, y: number): Point {
  const b = layout.boxes[pageIndex];
  return { x: (x - b.x) / layout.scale, y: (y - b.y) / layout.scale };
}

/**
 * New scroll offsets that keep the content point under (anchorX, anchorY)
 * (viewport-relative px) fixed when the scale changes from `from` to `to`.
 * Works because every page box scales linearly except for fixed gaps; the
 * gap error is corrected by the page-relative anchor.
 */
export function anchoredScroll(
  before: Layout,
  after: Layout,
  vp: Viewport,
  anchorX: number,
  anchorY: number
): { left: number; top: number } {
  const cx = vp.left + anchorX, cy = vp.top + anchorY;
  let i = pageAt(before, cx, cy, PAGE_GAP);
  if (i < 0) i = centerPage(before, vp);
  const pt = toPagePoint(before, i, cx, cy);
  const b = after.boxes[i];
  return { left: b.x + pt.x * after.scale - anchorX, top: b.y + pt.y * after.scale - anchorY };
}
