import { newId, PAGE_HEIGHT, PAGE_WIDTH, type PageElement } from "@/lib/document/types";
import { measureStrokeText } from "@/lib/drawing/strokeFont";
import type { AnswerBlock, AnswerDocument, ListItem } from "./answerSchema";
import { toUnicodeMath, formatMathInText } from "@/lib/math/unicodeMath";
import { layoutMath2D } from "@/lib/math/layoutMath2D";
import { sampleCurves, autoYRange, niceTicks } from "@/lib/math/graph";

/**
 * Deterministic layout: AnswerDocument → positioned PageElements per page.
 * Pure and synchronous — no canvas measurement, no network, no document
 * mutation. Text width is estimated with a fixed per-glyph table so layout is
 * identical in tests and in the browser.
 */

export const LAYOUT = {
  marginX: 56,
  marginTop: 72,
  marginBottom: 56,
  bodySize: 17,
  lineHeight: 1.5,
  blockGap: 14,
  indent: 22,
  codeSize: 12,
  codePadX: 10,
  codePadY: 8,
  calloutPad: 8,
  headingScale: [1.55, 1.3, 1.15] as const,
  tableCellPad: 6,
  tableRowH: 26,
} as const;

export const AI_INK = "#1d4ed8"; // blue ink fallback when user ink color is not provided

/** Distributive Omit — Omit alone doesn't work on a union. */
export type ElementInput = PageElement extends infer U
  ? U extends PageElement ? Omit<U, "id" | "groupId"> : never
  : never;

// Mono keeps a fixed em table; "hand" text measures its real glyph advances so
// wrapping matches what drawStrokeText actually renders. Deterministic.
export function measureText(text: string, size: number, mono = false): number {
  if (mono) return text.length * 0.62 * size;
  return measureStrokeText(text, size);
}

export function wrapText(text: string, maxWidth: number, size: number, mono = false): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (measureText(next, size, mono) <= maxWidth) {
      cur = next;
    } else if (cur) {
      lines.push(cur);
      cur = w;
    } else {
      // Single word wider than the line: hard-break it.
      let part = "";
      for (const ch of w) {
        if (measureText(part + ch, size, mono) > maxWidth) {
          if (part) lines.push(part);
          part = ch;
        } else part += ch;
      }
      cur = part;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

class Layouter {
  pages: PageElement[][] = [[]];
  page = 0;
  y: number = LAYOUT.marginTop;
  left: number = LAYOUT.marginX;
  width: number;
  inkColor: string;

  constructor(
    private doc: AnswerDocument,
    private groupId: string,
    private pageW: number,
    private pageH: number,
    inkColor = AI_INK
  ) {
    this.width = pageW - LAYOUT.marginX * 2;
    this.inkColor = inkColor;
  }

  private emit(el: ElementInput) {
    this.pages[this.page].push({ ...el, id: newId(), groupId: this.groupId });
  }

  get usableW() {
    return this.width;
  }

  get limitY() {
    return this.pageH - LAYOUT.marginBottom;
  }

  newPage() {
    this.page++;
    this.pages.push([]);
    this.y = LAYOUT.marginTop;
    this.left = LAYOUT.marginX;
    this.width = this.pageW - LAYOUT.marginX * 2;
  }

  /** Ensure `h` fits on this page; start a new page if not. */
  private need(h: number) {
    if (this.y + h > this.limitY && this.y > LAYOUT.marginTop) this.newPage();
  }

  private text(t: string, x: number, y: number, size: number, font: "hand" | "mono", bold: boolean, blockId: string, color = this.inkColor) {
    this.emit({ type: "text", x, y, text: t, font, size, bold, color, blockId });
  }

  /** Emit wrapped lines; may split across pages. */
  private paragraph(t: string, x: number, size: number, font: "hand" | "mono", bold: boolean, blockId: string, color = this.inkColor, width?: number) {
    const lh = size * LAYOUT.lineHeight;
    const w = width ?? this.left + this.width - x;
    for (const line of wrapText(t, w, size, font === "mono")) {
      this.need(lh);
      this.text(line, x, this.y, size, font, bold, blockId, color);
      this.y += lh;
    }
  }

  private gap(extra = 0) {
    this.y += LAYOUT.blockGap + extra;
  }

  private listItems(items: ListItem[], depth: number, numbered: boolean, blockId: string) {
    items.forEach((item, i) => {
      const bullet = numbered ? `${i + 1}.` : "•";
      const x = this.left + depth * LAYOUT.indent;
      const tx = x + LAYOUT.indent;
      const lh = LAYOUT.bodySize * LAYOUT.lineHeight;
      const lines = wrapText(formatMathInText(item.text), this.left + this.width - tx, LAYOUT.bodySize);
      lines.forEach((line, li) => {
        this.need(lh);
        if (li === 0) this.text(bullet, x, this.y, LAYOUT.bodySize, "hand", false, blockId);
        this.text(line, tx, this.y, LAYOUT.bodySize, "hand", false, blockId);
        this.y += lh;
      });
      if (item.children?.length) this.listItems(item.children, depth + 1, numbered, blockId);
    });
  }

  private block(b: AnswerBlock) {
    const S = LAYOUT;
    const x0 = this.left;
    switch (b.type) {
      case "heading": {
        const scale = S.headingScale[Math.min(b.level, 3) - 1];
        this.gap(4);
        this.paragraph(formatMathInText(b.text), x0, LAYOUT.bodySize * scale, "hand", true, b.id);
        this.gap(2);
        break;
      }
      case "paragraph":
        this.paragraph(formatMathInText(b.text), x0, S.bodySize, "hand", false, b.id);
        this.gap();
        break;
      case "list":
        this.listItems(b.items, 0, b.style === "numbered", b.id);
        this.gap();
        break;
      case "callout": {
        const lines = wrapText(formatMathInText(b.text), this.usableW - S.calloutPad * 2 - 14, S.bodySize);
        const h = lines.length * S.bodySize * S.lineHeight + S.calloutPad * 2;
        this.need(h);
        const top = this.y;
        const fill = b.kind === "warning" ? "#fef3c7" : b.kind === "tip" ? "#dcfce7" : "#dbeafe";
        const stroke = b.kind === "warning" ? "#d97706" : b.kind === "tip" ? "#16a34a" : "#2563eb";
        this.emit({ type: "rect", x: x0, y: top, w: this.usableW, h, fill, stroke, blockId: b.id });
        this.emit({ type: "line", x1: x0, y1: top, x2: x0, y2: top + h, width: 3, color: stroke, blockId: b.id });
        this.y = top + S.calloutPad + S.bodySize * 0.75;
        for (const line of lines) {
          this.text(line, x0 + S.calloutPad + 10, this.y, S.bodySize, "hand", false, b.id);
          this.y += S.bodySize * S.lineHeight;
        }
        this.y = top + h;
        this.gap();
        break;
      }
      case "math":
      case "derivation": {
        const steps = b.type === "math" ? [{ latex: b.latex }] : b.steps;
        for (const s of steps) {
          const mathBox = layoutMath2D(s.latex, {
            size: S.bodySize * 1.1,
            color: this.inkColor,
            blockId: b.id,
          });
          const totalH = mathBox.ascent + mathBox.descent;
          this.need(totalH + S.bodySize * 0.4);

          // Center horizontally within usable width, scale down slightly if very wide
          const maxAllowedW = this.usableW - 16;
          let scale = 1;
          if (mathBox.width > maxAllowedW && mathBox.width > 0) {
            scale = Math.max(0.65, maxAllowedW / mathBox.width);
          }
          const finalW = mathBox.width * scale;
          const startX = x0 + Math.max(0, (this.usableW - finalW) / 2);
          const baselineY = this.y + mathBox.ascent * scale;

          for (const el of mathBox.elements) {
            if (el.type === "text") {
              this.emit({
                type: "text",
                x: startX + el.relX * scale,
                y: baselineY + el.relY * scale,
                text: el.text,
                font: "hand",
                size: el.size * scale,
                bold: el.bold,
                color: el.color ?? this.inkColor,
                blockId: b.id,
              });
            } else if (el.type === "line") {
              this.emit({
                type: "line",
                x1: startX + el.x1 * scale,
                y1: baselineY + el.y1 * scale,
                x2: startX + el.x2 * scale,
                y2: baselineY + el.y2 * scale,
                width: Math.max(0.8, el.width * scale),
                color: el.color ?? this.inkColor,
                blockId: b.id,
              });
            }
          }
          this.y = baselineY + mathBox.descent * scale + S.bodySize * 0.6;

          if ("note" in s && s.note) {
            this.paragraph(`(${formatMathInText(s.note)})`, x0 + 40, S.bodySize * 0.85, "hand", false, b.id, "#64748b");
          }
        }
        this.gap();
        break;
      }
      case "definition":
        this.paragraph(formatMathInText(`${b.term} — ${b.definition}`), x0, S.bodySize, "hand", false, b.id);
        this.gap();
        break;
      case "code": {
        const lines = b.code.split("\n").flatMap((l) => wrapText(l || " ", this.usableW - S.codePadX * 2, S.codeSize, true));
        const top = this.y;
        this.need(Math.min(60, this.pageH));
        const rectIdx = this.pages[this.page].length;
        this.emit({ type: "rect", x: x0, y: top, w: this.usableW, h: 1, fill: "#f1f5f9", stroke: "#cbd5e1", blockId: b.id });
        const startPage = this.page;
        this.y = top + S.codePadY + S.codeSize;
        for (const line of lines) {
          this.need(S.codeSize * 1.4);
          this.text(line, x0 + S.codePadX, this.y, S.codeSize, "mono", false, b.id, "#0f172a");
          this.y += S.codeSize * 1.4;
        }
        const rect = this.pages[startPage][rectIdx];
        if (rect?.type === "rect") rect.h = this.y + S.codePadY - S.codeSize * 0.4 - top;
        if (b.explanation) {
          this.gap(2);
          this.paragraph(formatMathInText(b.explanation), x0, S.bodySize * 0.9, "hand", false, b.id, "#475569");
        }
        this.gap();
        break;
      }
      case "steps": {
        if (b.title) {
          this.paragraph(formatMathInText(b.title), x0, S.bodySize, "hand", true, b.id);
        }
        this.listItems(b.items.map((t) => ({ text: formatMathInText(t) })), 0, true, b.id);
        this.gap();
        break;
      }
      case "table": {
        const cols = b.headers.length;
        const colW = this.usableW / Math.max(1, cols);
        const allRows = [b.headers, ...b.rows];
        for (const [ri, row] of allRows.entries()) {
          this.need(S.tableRowH);
          const top = this.y;
          for (let ci = 0; ci < cols; ci++) {
            const cell = formatMathInText(row[ci] ?? "");
            const rx = x0 + ci * colW;
            this.emit({ type: "rect", x: rx, y: top, w: colW, h: S.tableRowH, fill: ri === 0 ? "#e2e8f0" : undefined, stroke: "#cbd5e1", blockId: b.id });
            const clipped = wrapText(cell, colW - S.tableCellPad * 2, S.bodySize * 0.8)[0] ?? "";
            this.text(clipped, rx + S.tableCellPad, top + S.tableRowH * 0.65, S.bodySize * 0.8, "hand", ri === 0, b.id, "#0f172a");
          }
          this.y += S.tableRowH;
        }
        this.gap();
        break;
      }
      case "diagram": {
        const boxH = 220;
        this.need(boxH);
        const top = this.y;
        const sx = (v: number) => x0 + (v / 100) * this.usableW;
        const sy = (v: number) => top + (v / 100) * boxH;
        for (const p of b.primitives) {
          if (p.type === "line" || p.type === "arrow") {
            this.emit({ type: "line", x1: sx(p.from.x), y1: sy(p.from.y), x2: sx(p.to.x), y2: sy(p.to.y), width: 2, color: "#334155", blockId: b.id });
            if (p.type === "arrow") {
              const dx = p.to.x - p.from.x, dy = p.to.y - p.from.y;
              const len = Math.hypot(dx, dy) || 1;
              const nx = dx / len, ny = dy / len;
              this.emit({ type: "line", x1: sx(p.to.x), y1: sy(p.to.y), x2: sx(p.to.x - nx * 6 - ny * 3), y2: sy(p.to.y - ny * 6 + nx * 3), width: 2, color: "#334155", blockId: b.id });
              this.emit({ type: "line", x1: sx(p.to.x), y1: sy(p.to.y), x2: sx(p.to.x - nx * 6 + ny * 3), y2: sy(p.to.y - ny * 6 - nx * 3), width: 2, color: "#334155", blockId: b.id });
            }
          } else if (p.type === "label") {
            this.text(formatMathInText(p.text), sx(p.x), sy(p.y), S.bodySize * 0.8, "hand", false, b.id, "#334155");
          } else {
            const rx = sx(p.x), ry = sy(p.y), rw = (p.w / 100) * this.usableW, rh = (p.h / 100) * boxH;
            this.emit({ type: "rect", x: rx, y: ry, w: rw, h: rh, fill: "#eff6ff", stroke: "#3b82f6", blockId: b.id });
            if (p.label) this.text(formatMathInText(p.label), rx + rw / 2 - measureText(p.label, 12) / 2, ry + rh / 2, 12, "hand", false, b.id, "#1e3a8a");
          }
        }
        if (b.title) this.text(formatMathInText(b.title), x0, top + boxH + 14, S.bodySize * 0.8, "hand", false, b.id, "#64748b");
        this.y = top + boxH + (b.title ? 24 : 0);
        this.gap();
        break;
      }
      case "check": {
        for (const l of b.lines) {
          const mark = l.status === "correct" ? "✓" : l.status === "error" ? "✗" : "?";
          const color = l.status === "correct" ? "#16a34a" : l.status === "error" ? "#dc2626" : "#d97706";
          const v = l.verification === "verified" ? " (verified)" : "";
          this.paragraph(
            `${mark} line ${l.lineIndex + 1}${v}${l.note ? ` — ${formatMathInText(l.note)}` : ""}${l.correction ? ` → ${toUnicodeMath(l.correction)}` : ""}`,
            x0,
            S.bodySize,
            "hand",
            false,
            b.id,
            color
          );
        }
        this.gap();
        break;
      }
      case "graph":
        this.graph(b);
        break;
      case "annotation": {
        const lines = wrapText(`◈ ${formatMathInText(b.text)}`, this.usableW - 20, S.bodySize * 0.9);
        for (const line of lines) {
          this.need(S.bodySize * S.lineHeight);
          this.text(line, x0 + 10, this.y, S.bodySize * 0.9, "hand", false, b.id, "#a16207");
          this.y += S.bodySize * S.lineHeight;
        }
        this.gap(4);
        break;
      }
    }
  }

  /** Axes, ticks, sampled curves and legend — all computed, never model points. */
  private graph(b: Extract<AnswerBlock, { type: "graph" }>) {
    const S = LAYOUT;
    const boxH = 200, w = Math.min(this.width, 420);
    const { curves, errors } = sampleCurves(b.expressions, b.xRange);
    const [y0, y1] = autoYRange(curves.map((c) => c.segments), b.yRange);
    const legendH = (curves.length + errors.length) * 16 + (b.title ? 20 : 0);
    this.need(boxH + legendH + 24);
    const left = this.left, top = this.y + (b.title ? 20 : 0);
    if (b.title) this.text(formatMathInText(b.title), left, this.y + 14, S.bodySize * 0.9, "hand", true, b.id);
    const [x0, x1] = b.xRange;
    const px = (x: number) => left + 30 + ((x - x0) / (x1 - x0)) * (w - 40);
    const py = (y: number) => top + boxH - 20 - ((y - y0) / (y1 - y0)) * (boxH - 30);
    const axisColor = "#334155";
    const ax = Math.min(Math.max(0, x0), x1), ay = Math.min(Math.max(0, y0), y1);
    this.emit({ type: "line", x1: px(x0), y1: py(ay), x2: px(x1), y2: py(ay), width: 1.2, color: axisColor, blockId: b.id });
    this.emit({ type: "line", x1: px(ax), y1: py(y0), x2: px(ax), y2: py(y1), width: 1.2, color: axisColor, blockId: b.id });
    for (const t of niceTicks(x0, x1)) {
      this.emit({ type: "line", x1: px(t), y1: py(ay) - 3, x2: px(t), y2: py(ay) + 3, width: 1, color: axisColor, blockId: b.id });
      this.text(String(+t.toFixed(4)), px(t) - 6, py(ay) + 14, 10, "hand", false, b.id, axisColor);
    }
    for (const t of niceTicks(y0, y1, 5)) {
      this.emit({ type: "line", x1: px(ax) - 3, y1: py(t), x2: px(ax) + 3, y2: py(t), width: 1, color: axisColor, blockId: b.id });
      this.text(String(+t.toFixed(4)), px(ax) - 26, py(t) + 3, 10, "hand", false, b.id, axisColor);
    }
    const colors = [this.inkColor, "#dc2626", "#16a34a", "#7c3aed"];
    curves.forEach((c, ci) => {
      const color = colors[ci % colors.length];
      for (const seg of c.segments) {
        const step = Math.max(1, Math.ceil(seg.length / 120)); // bound element count
        for (let i = step; i < seg.length; i += step) {
          const [ax0, ay0] = seg[i - step], [ax1, ay1] = seg[i];
          if ([ay0, ay1].some((v) => v < y0 || v > y1)) continue; // clip to plot area
          this.emit({ type: "line", x1: px(ax0), y1: py(ay0), x2: px(ax1), y2: py(ay1), width: 2, color, blockId: b.id });
        }
      }
    });
    this.y = top + boxH;
    curves.forEach((c, ci) => {
      this.text(`— ${toUnicodeMath(c.label)}`, left + 30, this.y, 13, "hand", false, b.id, colors[ci % colors.length]);
      this.y += 16;
    });
    for (const e of errors) {
      this.text(`Not plotted: ${e}`, left + 30, this.y, 12, "hand", false, b.id, "#dc2626");
      this.y += 16;
    }
    this.gap();
  }

  run(): PageElement[][] {
    this.paragraph(formatMathInText(this.doc.title), this.left, LAYOUT.bodySize * 1.4, "hand", true, "__title");
    this.emit({ type: "line", x1: this.left, y1: this.y - 6, x2: this.left + this.width, y2: this.y - 6, width: 1.5, color: this.inkColor, blockId: "__title" });
    this.gap();
    for (const b of this.doc.blocks) this.block(b);
    return this.pages;
  }
}

export type LayoutResult = {
  /** PageElement lists; index 0 is the starting page, rest are new pages. */
  pages: PageElement[][];
  groupId: string;
};

/**
 * Lay out an answer. `startY` positions content below existing material on the
 * starting page; additional pages use the full height.
 */
export function layoutAnswer(
  doc: AnswerDocument,
  opts: {
    pageWidth?: number;
    pageHeight?: number;
    startY?: number;
    region?: { x: number; y: number; width: number };
    inkColor?: string;
  } = {}
): LayoutResult {
  const pageW = opts.pageWidth ?? PAGE_WIDTH;
  const pageH = opts.pageHeight ?? PAGE_HEIGHT;
  const groupId = newId();
  const l = new Layouter(doc, groupId, pageW, pageH, opts.inkColor);
  if (opts.region) {
    l.left = opts.region.x;
    l.width = opts.region.width;
    l.y = Math.max(LAYOUT.marginTop, opts.region.y);
  } else if (opts.startY != null && opts.startY > LAYOUT.marginTop) l.y = opts.startY + LAYOUT.blockGap;
  const pages = l.run();
  return { pages, groupId };
}

/** Scales tried (largest first) to keep an answer on the current page. */
export const FIT_SCALES = [1, 0.9, 0.8, 0.7, 0.6] as const;

function scaleElement(e: PageElement, s: number, ox: number, oy: number): PageElement {
  const X = (x: number) => ox + (x - ox) * s;
  const Y = (y: number) => oy + (y - oy) * s;
  switch (e.type) {
    case "text":
      return { ...e, x: X(e.x), y: Y(e.y), size: e.size * s };
    case "line":
      return { ...e, x1: X(e.x1), y1: Y(e.y1), x2: X(e.x2), y2: Y(e.y2), width: e.width != null ? e.width * s : e.width };
    case "rect":
      return { ...e, x: X(e.x), y: Y(e.y), w: e.w * s, h: e.h * s };
  }
}

/**
 * Lay out `doc` inside `region` on ONE page, shrinking it (down to 60%) if
 * that's what it takes to fit above the bottom margin. The answer is laid out
 * in a virtually larger region (width/s, height/s) and then scaled by s about
 * the region's top-left, so wrapping stays natural. Returns null when even the
 * smallest scale overflows.
 */
export function layoutFitted(
  doc: AnswerDocument,
  region: { x: number; y: number; width: number },
  opts: { pageWidth?: number; pageHeight?: number; inkColor?: string } = {}
): (LayoutResult & { scale: number }) | null {
  const pageH = opts.pageHeight ?? PAGE_HEIGHT;
  const y0 = Math.max(LAYOUT.marginTop, region.y);
  const limit = pageH - LAYOUT.marginBottom;
  if (limit - y0 < 40) return null;
  for (const s of FIT_SCALES) {
    // Virtual page whose bottom margin maps to the real one after scaling.
    const vPageH = y0 + (limit - y0) / s + LAYOUT.marginBottom;
    const r = layoutAnswer(doc, { ...opts, pageHeight: vPageH, region: { x: region.x, y: y0, width: region.width / s } });
    if (r.pages.length !== 1) continue;
    const pages = s === 1 ? r.pages : [r.pages[0].map((e) => scaleElement(e, s, region.x, y0))];
    return { pages, groupId: r.groupId, scale: s };
  }
  return null;
}

export type Placement = "below" | "right" | "flow";
const MIN_REGION_WIDTH = 220;

/**
 * Place an answer below everything already on the page (`startY`), shrinking
 * it to stay on this page if needed; only when even 60% won't fit does it
 * flow onto new pages.
 */
export function placeOnPage(
  doc: AnswerDocument,
  opts: { pageWidth?: number; pageHeight?: number; startY?: number; inkColor?: string } = {}
): LayoutResult & { placement: Placement } {
  const pageW = opts.pageWidth ?? PAGE_WIDTH;
  const y = opts.startY && opts.startY > LAYOUT.marginTop ? opts.startY + LAYOUT.blockGap : LAYOUT.marginTop;
  const fit = layoutFitted(doc, { x: LAYOUT.marginX, y, width: pageW - LAYOUT.marginX * 2 }, opts);
  return fit ? { pages: fit.pages, groupId: fit.groupId, placement: "flow" } : { ...layoutAnswer(doc, opts), placement: "flow" };
}

/**
 * Place an answer beside the student's work, always preferring the same page:
 * directly below the selection, else to its right, else below everything on
 * the page — each attempt may shrink the answer (to 60%) to fit. Only if none
 * fit does it continue onto new pages.
 */
export function placeNearSelection(
  doc: AnswerDocument,
  sel: { minX: number; minY: number; maxX: number; maxY: number },
  opts: { pageWidth?: number; pageHeight?: number; startY?: number; inkColor?: string } = {}
): LayoutResult & { placement: Placement } {
  const pageW = opts.pageWidth ?? PAGE_WIDTH;
  const right = pageW - LAYOUT.marginX;
  // `startY` is the bottom of content already on the page. If it reaches past
  // the selection's top, earlier answers sit beside/below the work: stack
  // under them instead of drawing on top.
  const occupied = opts.startY ?? 0;
  const crowded = occupied > sel.minY;
  // Align with the work, unless that leaves a cramped column.
  const bx = sel.minX > pageW * 0.4 ? LAYOUT.marginX : Math.max(LAYOUT.marginX, sel.minX);
  const below = { x: bx, y: Math.max(sel.maxY + 16, crowded ? occupied + LAYOUT.blockGap : 0) };
  const pick = (region: { x: number; y: number; width: number }, placement: Placement) => {
    if (region.width < MIN_REGION_WIDTH) return null;
    const r = layoutFitted(doc, region, opts);
    return r ? { pages: r.pages, groupId: r.groupId, placement } : null;
  };
  return (
    pick({ ...below, width: right - below.x }, "below") ??
    (!crowded ? pick({ x: sel.maxX + 20, y: sel.minY, width: right - sel.maxX - 20 }, "right") : null) ??
    placeOnPage(doc, opts)
  );
}
