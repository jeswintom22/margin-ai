import { newId, PAGE_HEIGHT, PAGE_WIDTH, type PageElement } from "@/lib/document/types";
import type { AnswerBlock, AnswerDocument, ListItem } from "./answerSchema";

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

export const AI_INK = "#1d4ed8"; // blue ink, visually distinct from user strokes

/** Distributive Omit — Omit alone doesn't work on a union. */
export type ElementInput = PageElement extends infer U
  ? U extends PageElement ? Omit<U, "id" | "groupId"> : never
  : never;

// Approximate em-widths (avg for Kalam ~0.5; mono fixed 0.62). Deterministic.
const WIDE = "mwMW@#%&";
const NARROW = "ilIjJ.,;:'\"!|()[]{} ";
export function measureText(text: string, size: number, mono = false): number {
  let units = 0;
  for (const ch of text) {
    units += mono ? 0.62 : WIDE.includes(ch) ? 0.82 : NARROW.includes(ch) ? 0.3 : 0.5;
  }
  return units * size;
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

  constructor(
    private doc: AnswerDocument,
    private groupId: string,
    private pageW: number,
    private pageH: number
  ) {}

  private emit(el: ElementInput) {
    this.pages[this.page].push({ ...el, id: newId(), groupId: this.groupId });
  }

  get usableW() {
    return this.pageW - LAYOUT.marginX * 2;
  }

  get limitY() {
    return this.pageH - LAYOUT.marginBottom;
  }

  newPage() {
    this.page++;
    this.pages.push([]);
    this.y = LAYOUT.marginTop;
  }

  /** Ensure `h` fits on this page; start a new page if not. */
  private need(h: number) {
    if (this.y + h > this.limitY && this.y > LAYOUT.marginTop) this.newPage();
  }

  private text(t: string, x: number, y: number, size: number, font: "hand" | "mono", bold: boolean, blockId: string, color = AI_INK) {
    this.emit({ type: "text", x, y, text: t, font, size, bold, color, blockId });
  }

  /** Emit wrapped lines; may split across pages. */
  private paragraph(t: string, x: number, size: number, font: "hand" | "mono", bold: boolean, blockId: string, color = AI_INK, width?: number) {
    const lh = size * LAYOUT.lineHeight;
    const w = width ?? this.pageW - LAYOUT.marginX - x;
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
      const x = LAYOUT.marginX + depth * LAYOUT.indent;
      const tx = x + LAYOUT.indent;
      const lh = LAYOUT.bodySize * LAYOUT.lineHeight;
      const lines = wrapText(item.text, this.pageW - LAYOUT.marginX - tx, LAYOUT.bodySize);
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
    const x0 = S.marginX;
    switch (b.type) {
      case "heading": {
        const scale = S.headingScale[Math.min(b.level, 3) - 1];
        this.gap(4);
        this.paragraph(b.text, x0, LAYOUT.bodySize * scale, "hand", true, b.id);
        this.gap(2);
        break;
      }
      case "paragraph":
        this.paragraph(b.text, x0, S.bodySize, "hand", false, b.id);
        this.gap();
        break;
      case "list":
        this.listItems(b.items, 0, b.style === "numbered", b.id);
        this.gap();
        break;
      case "callout": {
        const lines = wrapText(b.text, this.usableW - S.calloutPad * 2 - 14, S.bodySize);
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
          const lines = wrapText(s.latex, this.usableW - 40, S.bodySize, true);
          this.need(lines.length * S.bodySize * S.lineHeight);
          for (const line of lines) {
            const w = measureText(line, S.bodySize, true);
            this.text(line, x0 + Math.max(0, (this.usableW - w) / 2), this.y, S.bodySize, "mono", false, b.id);
            this.y += S.bodySize * S.lineHeight;
          }
          if ("note" in s && s.note) {
            this.paragraph(`(${s.note})`, x0 + 40, S.bodySize * 0.85, "hand", false, b.id, "#64748b");
          }
        }
        this.gap();
        break;
      }
      case "definition":
        this.paragraph(`${b.term} — ${b.definition}`, x0, S.bodySize, "hand", false, b.id);
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
          this.paragraph(b.explanation, x0, S.bodySize * 0.9, "hand", false, b.id, "#475569");
        }
        this.gap();
        break;
      }
      case "steps": {
        if (b.title) {
          this.paragraph(b.title, x0, S.bodySize, "hand", true, b.id);
        }
        this.listItems(b.items.map((t) => ({ text: t })), 0, true, b.id);
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
            const cell = row[ci] ?? "";
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
            this.text(p.text, sx(p.x), sy(p.y), S.bodySize * 0.8, "hand", false, b.id, "#334155");
          } else {
            const rx = sx(p.x), ry = sy(p.y), rw = (p.w / 100) * this.usableW, rh = (p.h / 100) * boxH;
            this.emit({ type: "rect", x: rx, y: ry, w: rw, h: rh, fill: "#eff6ff", stroke: "#3b82f6", blockId: b.id });
            if (p.label) this.text(p.label, rx + rw / 2 - measureText(p.label, 12) / 2, ry + rh / 2, 12, "hand", false, b.id, "#1e3a8a");
          }
        }
        if (b.title) this.text(b.title, x0, top + boxH + 14, S.bodySize * 0.8, "hand", false, b.id, "#64748b");
        this.y = top + boxH + (b.title ? 24 : 0);
        this.gap();
        break;
      }
      case "annotation": {
        const lines = wrapText(`◈ ${b.text}`, this.usableW - 20, S.bodySize * 0.9);
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

  run(): PageElement[][] {
    this.paragraph(this.doc.title, LAYOUT.marginX, LAYOUT.bodySize * 1.4, "hand", true, "__title");
    this.emit({ type: "line", x1: LAYOUT.marginX, y1: this.y - 6, x2: this.pageW - LAYOUT.marginX, y2: this.y - 6, width: 1.5, color: AI_INK, blockId: "__title" });
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
  opts: { pageWidth?: number; pageHeight?: number; startY?: number } = {}
): LayoutResult {
  const pageW = opts.pageWidth ?? PAGE_WIDTH;
  const pageH = opts.pageHeight ?? PAGE_HEIGHT;
  const groupId = newId();
  const l = new Layouter(doc, groupId, pageW, pageH);
  if (opts.startY != null && opts.startY > LAYOUT.marginTop) l.y = opts.startY + LAYOUT.blockGap;
  const pages = l.run();
  return { pages, groupId };
}
