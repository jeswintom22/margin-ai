/**
 * Coordinate conversion between client (screen) space and page (document) space.
 * The page is rendered at `scale`, centered horizontally. Vertically it is
 * centered when it fits; when it is taller than the viewport it starts at
 * PAGE_GAP and is offset by `scrollY` (CSS px).
 */
export const PAGE_GAP = 24;

/** Top-left of the page inside the canvas, in CSS px. */
export function pageOffset(
  viewW: number,
  viewH: number,
  pageWidth: number,
  pageHeight: number,
  scale: number,
  scrollY = 0
): { x: number; y: number } {
  const h = pageHeight * scale;
  return {
    x: (viewW - pageWidth * scale) / 2,
    y: h + PAGE_GAP * 2 <= viewH ? (viewH - h) / 2 : PAGE_GAP - scrollY,
  };
}

/** Largest scrollY for a page at `scale` in a viewport of height viewH. */
export function maxScroll(viewH: number, pageHeight: number, scale: number): number {
  return Math.max(0, pageHeight * scale + PAGE_GAP * 2 - viewH);
}

export function clientToPage(
  clientX: number,
  clientY: number,
  canvasRect: { left: number; top: number; width: number; height: number },
  pageWidth: number,
  pageHeight: number,
  scale: number,
  scrollY = 0
): { x: number; y: number } {
  const o = pageOffset(canvasRect.width, canvasRect.height, pageWidth, pageHeight, scale, scrollY);
  return {
    x: (clientX - canvasRect.left - o.x) / scale,
    y: (clientY - canvasRect.top - o.y) / scale,
  };
}

/** Scale that fits the page inside a container with the given margin factor. */
export function fitScale(
  containerW: number,
  containerH: number,
  pageW: number,
  pageH: number,
  margin = 0.92
): number {
  return Math.min(containerW / pageW, containerH / pageH) * margin;
}

/** Scale that fits the page width (minus gaps), capped so huge screens don't blow it up. */
export function fitWidthScale(containerW: number, pageW: number, max = 1.5): number {
  return Math.max(0.2, Math.min(max, (containerW - PAGE_GAP * 2) / pageW));
}
