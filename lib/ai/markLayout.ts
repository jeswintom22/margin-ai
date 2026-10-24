import { newId, type PageElement, type Stroke } from "@/lib/document/types";
import { strokeBounds } from "@/lib/drawing/geometry";
import type { AnswerBlock } from "./answerSchema";

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type CheckBlock = Extract<AnswerBlock, { type: "check" }>;

export const MARK_COLORS = { correct: "#16a34a", error: "#dc2626", unclear: "#d97706" } as const;

export function unionBounds(bs: Bounds[]): Bounds {
  return bs.reduce((a, c) => ({
    minX: Math.min(a.minX, c.minX), minY: Math.min(a.minY, c.minY),
    maxX: Math.max(a.maxX, c.maxX), maxY: Math.max(a.maxY, c.maxY),
  }));
}

/**
 * Cluster strokes into handwriting lines: sort by vertical centre and merge a
 * stroke into the current line when it overlaps the line's vertical extent.
 * Deterministic; returns line bounds top to bottom.
 */
export function groupLines(strokes: Stroke[]): Bounds[] {
  const items = strokes.map(strokeBounds).sort((a, b) => (a.minY + a.maxY) - (b.minY + b.maxY));
  const lines: Bounds[] = [];
  for (const b of items) {
    const cur = lines[lines.length - 1];
    const cy = (b.minY + b.maxY) / 2;
    // Same line if the stroke's centre falls within the line's extent, padded
    // for handwriting wobble (at least 10 units, or half the line height).
    const tol = cur ? Math.max(10, (cur.maxY - cur.minY) / 2) : 0;
    if (cur && cy >= cur.minY - tol && cy <= cur.maxY + tol) lines[lines.length - 1] = unionBounds([cur, b]);
    else lines.push(b);
  }
  return lines;
}

/**
 * Position check marks beside the student's lines. When the stroke clusters
 * match the transcribed line count, each mark sits next to its line (errors
 * also get an underline); otherwise marks are stacked to the right of the
 * selection in line order. Marks never extend past the page's right edge.
 */
export function layoutCheckMarks(
  check: CheckBlock,
  strokes: Stroke[],
  groupId: string,
  lineCount: number,
  pageWidth: number
): PageElement[] {
  if (!strokes.length) return [];
  const sel = unionBounds(strokes.map(strokeBounds));
  const lines = groupLines(strokes);
  const aligned = lines.length === lineCount;
  const out: PageElement[] = [];
  const base = { groupId, blockId: check.id };
  for (const entry of check.lines) {
    const color = MARK_COLORS[entry.status];
    const line = aligned ? lines[entry.lineIndex] : undefined;
    const y = line ? (line.minY + line.maxY) / 2 + 7 : sel.minY + 20 + entry.lineIndex * 26;
    const x = Math.min((line?.maxX ?? sel.maxX) + 14, pageWidth - 40);
    const symbol = entry.status === "correct" ? "✓" : entry.status === "error" ? "✗" : "?";
    out.push({ ...base, id: newId(), type: "text", x, y, text: symbol, font: "hand", size: 22, bold: true, color });
    if (entry.status === "error" && line) {
      out.push({ ...base, id: newId(), type: "line", x1: line.minX, y1: line.maxY + 4, x2: line.maxX, y2: line.maxY + 4, width: 2, color });
    }
    const verified = entry.verification === "verified" ? " (verified)" : "";
    const label = entry.status === "error" ? [entry.note, entry.correction && `→ ${entry.correction}`].filter(Boolean).join(" ") : verified.trim();
    if (label) {
      out.push({ ...base, id: newId(), type: "text", x: Math.min(x + 22, pageWidth - 160), y, text: label.slice(0, 80), font: "hand", size: 13, color });
    }
  }
  return out;
}
