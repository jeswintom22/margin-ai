/**
 * Coordinate conversion between client (screen) space and page (document) space.
 * The page is centered inside the canvas element and rendered at `scale`.
 */
export function clientToPage(
  clientX: number,
  clientY: number,
  canvasRect: { left: number; top: number; width: number; height: number },
  pageWidth: number,
  pageHeight: number,
  scale: number
): { x: number; y: number } {
  const offsetX = (canvasRect.width - pageWidth * scale) / 2;
  const offsetY = (canvasRect.height - pageHeight * scale) / 2;
  return {
    x: (clientX - canvasRect.left - offsetX) / scale,
    y: (clientY - canvasRect.top - offsetY) / scale,
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
