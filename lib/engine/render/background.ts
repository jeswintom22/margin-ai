import type { Page } from "@/lib/xdoc/types";
import { RULING, isDarkColor } from "@/lib/xdoc/templates";
import type { AssetCache } from "./assets";

/** Paper color behind content (whiteout strokes paint with this). */
export function paperColor(page: Page): string {
  return page.background.kind === "solid" ? page.background.color : "#ffffff";
}

/**
 * Draw the page background in page space (ctx already scaled to points).
 * PDF backgrounds are drawn by `drawPdf` when provided (P5); until then and
 * while loading, a white page is shown.
 */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  page: Page,
  assets?: AssetCache | null,
  drawPdf?: (ctx: CanvasRenderingContext2D, page: Page) => boolean
) {
  const { width: W, height: H, background: bg } = page;
  ctx.fillStyle = paperColor(page);
  ctx.fillRect(0, 0, W, H);
  if (bg.kind === "pdf") {
    drawPdf?.(ctx, page);
    return;
  }
  if (bg.kind === "image") {
    const img = assets?.blobImage(bg.blobId);
    if (img) ctx.drawImage(img, 0, 0, W, H);
    return;
  }
  if (bg.style === "plain") return;
  const dark = isDarkColor(bg.color);
  const rule = dark ? "#55606e" : "#bcd0ea";
  ctx.save();
  ctx.strokeStyle = rule;
  ctx.fillStyle = rule;
  ctx.lineWidth = 0.5;
  const hLines = (start: number, step: number) => {
    ctx.beginPath();
    for (let y = start; y < H; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
  };
  const vLines = (step: number) => {
    ctx.beginPath();
    for (let x = step; x < W; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    ctx.stroke();
  };
  switch (bg.style) {
    case "lined":
      hLines(RULING.headerSpace, RULING.lineSpacing);
      break;
    case "ruled":
      hLines(RULING.headerSpace, RULING.lineSpacing);
      ctx.strokeStyle = dark ? "#a05a5a" : "#f2a6a6";
      ctx.beginPath();
      ctx.moveTo(RULING.marginX, 0);
      ctx.lineTo(RULING.marginX, H);
      ctx.stroke();
      break;
    case "graph":
      hLines(RULING.gridSize, RULING.gridSize);
      vLines(RULING.gridSize);
      break;
    case "dotted":
      for (let y = RULING.dotSize; y < H; y += RULING.dotSize)
        for (let x = RULING.dotSize; x < W; x += RULING.dotSize) {
          ctx.beginPath();
          ctx.arc(x, y, 0.75, 0, Math.PI * 2);
          ctx.fill();
        }
      break;
    case "isoDotted":
    case "isoGraph": {
      const s = RULING.isoSize;
      const rowH = s * (Math.sqrt(3) / 2);
      if (bg.style === "isoDotted") {
        for (let r = 1, y = rowH; y < H; r++, y += rowH)
          for (let x = r % 2 ? s / 2 : s; x < W; x += s) {
            ctx.beginPath();
            ctx.arc(x, y, 0.75, 0, Math.PI * 2);
            ctx.fill();
          }
      } else {
        hLines(rowH, rowH);
        const slope = Math.tan(Math.PI / 3);
        ctx.beginPath();
        for (let x0 = -H / slope; x0 < W; x0 += s) {
          ctx.moveTo(x0, 0);
          ctx.lineTo(x0 + H / slope, H);
          ctx.moveTo(x0 + H / slope, 0);
          ctx.lineTo(x0, H);
        }
        ctx.stroke();
      }
      break;
    }
    case "staves":
      ctx.beginPath();
      for (let top = RULING.headerSpace; top + RULING.staveGap * 4 < H - 36; top += RULING.staveSpacing)
        for (let i = 0; i < 5; i++) {
          const y = top + i * RULING.staveGap;
          ctx.moveTo(36, y);
          ctx.lineTo(W - 36, y);
        }
      ctx.stroke();
      break;
  }
  ctx.restore();
}
