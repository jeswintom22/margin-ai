/**
 * Real 2D math layout engine for handwritten notebook canvas.
 *
 * Compiles parsed LaTeX AST (MathNode) into positioned 2D PageElements:
 * - Fractions: centered numerator, single-stroke fraction bar line, centered denominator.
 * - Radicals: hand-drawn radical hook and vinculum overline line covering radicand.
 * - Superscripts / Subscripts: scaled and shifted above/below baseline.
 * - Delimiters: dynamically sized brackets and parentheses.
 * - All text elements use font: "hand" (single-stroke pen lettering with organic jitter).
 * - All lines and text match the user's active pen ink color.
 */

import { parseLatex, type MathNode } from "./latex";
import {
  measureStrokeText,
  strokeWidthFor,
  CAP_HEIGHT,
  AXIS,
} from "@/lib/drawing/strokeFont";

export type Math2DElement =
  | {
      type: "text";
      relX: number;
      relY: number; // baseline y offset (y is down: negative = above main baseline, positive = below)
      text: string;
      size: number;
      font: "hand";
      bold?: boolean;
      color?: string;
      blockId?: string;
    }
  | {
      type: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      width: number;
      color?: string;
      blockId?: string;
    };

export type Math2DBox = {
  width: number;
  ascent: number; // distance above baseline (positive number, so top is baseline - ascent)
  descent: number; // distance below baseline (positive number, so bottom is baseline + descent)
  elements: Math2DElement[];
};

function shiftElements(
  elements: Math2DElement[],
  dx: number,
  dy: number
): Math2DElement[] {
  return elements.map((el) => {
    if (el.type === "text") {
      return {
        ...el,
        relX: el.relX + dx,
        relY: el.relY + dy,
      };
    }
    return {
      ...el,
      x1: el.x1 + dx,
      y1: el.y1 + dy,
      x2: el.x2 + dx,
      y2: el.y2 + dy,
    };
  });
}

const RELATIONS = new Set(["=", "<", ">", "≤", "≥", "≠", "≈", "≡", "→", "←", "⇒", "⇔", "∈", "⊂"]);
const OPERATORS = new Set(["+", "−", "-", "±", "∓", "×", "·", "÷"]);

function layoutNode(
  node: MathNode,
  size: number,
  color: string,
  blockId?: string
): Math2DBox {
  switch (node.t) {
    case "space":
      return {
        width: size * 0.3,
        ascent: 0,
        descent: 0,
        elements: [],
      };

    case "text":
    case "sym": {
      const v = node.v;
      if (!v) {
        return { width: 0, ascent: 0, descent: 0, elements: [] };
      }
      const w = measureStrokeText(v, size);
      const isWord = /^[a-zA-Z]{2,}$/.test(v);
      const extraPad = isWord ? size * 0.16 : 0;
      return {
        width: w + extraPad,
        ascent: CAP_HEIGHT * size,
        descent: 0.22 * size,
        elements: [
          {
            type: "text",
            relX: 0,
            relY: 0,
            text: v,
            size,
            font: "hand",
            color,
            blockId,
          },
        ],
      };
    }

    case "row":
      return layoutRow(node, size, color, blockId);

    case "frac":
      return layoutFrac(node, size, color, blockId);

    case "sqrt":
      return layoutSqrt(node, size, color, blockId);

    case "scripts":
      return layoutScripts(node, size, color, blockId);

    case "delim":
      return layoutDelim(node, size, color, blockId);
  }
}

function layoutRow(
  node: Extract<MathNode, { t: "row" }>,
  size: number,
  color: string,
  blockId?: string
): Math2DBox {
  let curX = 0;
  let maxAscent = CAP_HEIGHT * size;
  let maxDescent = 0.22 * size;
  const elements: Math2DElement[] = [];

  for (let i = 0; i < node.c.length; i++) {
    const child = node.c[i];
    let spaceBefore = 0;
    let spaceAfter = 0;

    if (child.t === "sym") {
      const v = child.v;
      if (RELATIONS.has(v)) {
        spaceBefore = size * 0.22;
        spaceAfter = size * 0.22;
      } else if (OPERATORS.has(v)) {
        if (i > 0 && node.c[i - 1].t !== "space") {
          spaceBefore = size * 0.16;
        }
        spaceAfter = size * 0.16;
      }
    }

    curX += spaceBefore;
    const box = layoutNode(child, size, color, blockId);
    elements.push(...shiftElements(box.elements, curX, 0));
    curX += box.width + spaceAfter;
    maxAscent = Math.max(maxAscent, box.ascent);
    maxDescent = Math.max(maxDescent, box.descent);
  }

  return {
    width: curX,
    ascent: maxAscent,
    descent: maxDescent,
    elements,
  };
}

function layoutFrac(
  node: Extract<MathNode, { t: "frac" }>,
  size: number,
  color: string,
  blockId?: string
): Math2DBox {
  const scale = node.small ? 0.72 : 0.85;
  const subSize = Math.max(10, size * scale);
  const num = layoutNode(node.n, subSize, color, blockId);
  const den = layoutNode(node.d, subSize, color, blockId);

  const padX = size * 0.18;
  const barW = Math.max(num.width, den.width) + padX * 2;
  const barThickness = Math.max(1.2, strokeWidthFor(size) * 0.85);
  const barY = -AXIS * size;
  const gap = size * 0.16;

  const numY = barY - barThickness / 2 - gap - num.descent;
  const numX = (barW - num.width) / 2;

  const denY = barY + barThickness / 2 + gap + den.ascent;
  const denX = (barW - den.width) / 2;

  const elements: Math2DElement[] = [
    {
      type: "line",
      x1: 0,
      y1: barY,
      x2: barW,
      y2: barY,
      width: barThickness,
      color,
      blockId,
    },
    ...shiftElements(num.elements, numX, numY),
    ...shiftElements(den.elements, denX, denY),
  ];

  return {
    width: barW,
    ascent: Math.max(CAP_HEIGHT * size, -numY + num.ascent),
    descent: Math.max(0.22 * size, denY + den.descent),
    elements,
  };
}

function layoutSqrt(
  node: Extract<MathNode, { t: "sqrt" }>,
  size: number,
  color: string,
  blockId?: string
): Math2DBox {
  const c = layoutNode(node.c, size, color, blockId);
  const topY = -c.ascent - size * 0.12;
  const botY = c.descent + size * 0.05;
  const h = botY - topY;
  const barThickness = Math.max(1.2, strokeWidthFor(size) * 0.85);
  const rootW = Math.max(size * 0.48, Math.min(size * 0.8, h * 0.35));

  const p0x = 0;
  const p0y = botY - h * 0.45;
  const p1x = rootW * 0.22;
  const p1y = botY - h * 0.55;
  const p2x = rootW * 0.48;
  const p2y = botY;
  const p3x = rootW;
  const p3y = topY;
  const p4x = rootW + c.width + size * 0.14;
  const p4y = topY;

  const elements: Math2DElement[] = [
    { type: "line", x1: p0x, y1: p0y, x2: p1x, y2: p1y, width: barThickness, color, blockId },
    { type: "line", x1: p1x, y1: p1y, x2: p2x, y2: p2y, width: barThickness, color, blockId },
    { type: "line", x1: p2x, y1: p2y, x2: p3x, y2: p3y, width: barThickness, color, blockId },
    { type: "line", x1: p3x, y1: p3y, x2: p4x, y2: p4y, width: barThickness, color, blockId },
    ...shiftElements(c.elements, rootW + size * 0.06, 0),
  ];

  if (node.idx) {
    const idx = layoutNode(node.idx, size * 0.55, color, blockId);
    const idxX = 0;
    const idxY = botY - h * 0.72;
    elements.push(...shiftElements(idx.elements, idxX, idxY));
  }

  return {
    width: rootW + c.width + size * 0.16,
    ascent: Math.max(CAP_HEIGHT * size, -topY),
    descent: Math.max(0.22 * size, botY),
    elements,
  };
}

function layoutScripts(
  node: Extract<MathNode, { t: "scripts" }>,
  size: number,
  color: string,
  blockId?: string
): Math2DBox {
  const base = layoutNode(node.base, size, color, blockId);
  const subSize = Math.max(10, size * 0.68);
  const gapX = size * 0.05;
  const curX = base.width + gapX;
  const elements: Math2DElement[] = [...base.elements];
  let ascent = base.ascent;
  let descent = base.descent;
  let scriptW = 0;

  if (node.sup) {
    const sup = layoutNode(node.sup, subSize, color, blockId);
    const supY = -base.ascent * 0.55 - sup.descent;
    elements.push(...shiftElements(sup.elements, curX, supY));
    ascent = Math.max(ascent, -supY + sup.ascent);
    scriptW = Math.max(scriptW, sup.width);
  }

  if (node.sub) {
    const sub = layoutNode(node.sub, subSize, color, blockId);
    const subY = base.descent * 0.4 + sub.ascent * 0.65;
    elements.push(...shiftElements(sub.elements, curX, subY));
    descent = Math.max(descent, subY + sub.descent);
    scriptW = Math.max(scriptW, sub.width);
  }

  return {
    width: curX + scriptW,
    ascent,
    descent,
    elements,
  };
}

function layoutDelim(
  node: Extract<MathNode, { t: "delim" }>,
  size: number,
  color: string,
  blockId?: string
): Math2DBox {
  const c = layoutNode(node.c, size, color, blockId);
  const totalH = c.ascent + c.descent;

  if (totalH <= size * 1.35) {
    const leftText = node.l;
    const rightText = node.r;
    const lW = leftText ? measureStrokeText(leftText, size) : 0;
    const rW = rightText ? measureStrokeText(rightText, size) : 0;
    const pad = size * 0.06;
    const elements: Math2DElement[] = [];
    if (leftText) {
      elements.push({ type: "text", relX: 0, relY: 0, text: leftText, size, font: "hand", color, blockId });
    }
    elements.push(...shiftElements(c.elements, lW + pad, 0));
    if (rightText) {
      elements.push({
        type: "text",
        relX: lW + pad + c.width + pad,
        relY: 0,
        text: rightText,
        size,
        font: "hand",
        color,
        blockId,
      });
    }
    return {
      width: lW + pad + c.width + pad + rW,
      ascent: c.ascent,
      descent: c.descent,
      elements,
    };
  }

  const topY = -c.ascent - size * 0.08;
  const botY = c.descent + size * 0.08;
  const delimW = Math.max(size * 0.32, size * 0.08 * (botY - topY) / size);
  const barThickness = Math.max(1.2, strokeWidthFor(size) * 0.85);
  const elements: Math2DElement[] = [];

  let curX = 0;
  if (node.l) {
    if (node.l === "[" || node.l === "{") {
      elements.push(
        { type: "line", x1: delimW, y1: topY, x2: 0, y2: topY, width: barThickness, color, blockId },
        { type: "line", x1: 0, y1: topY, x2: 0, y2: botY, width: barThickness, color, blockId },
        { type: "line", x1: 0, y1: botY, x2: delimW, y2: botY, width: barThickness, color, blockId }
      );
    } else if (node.l === "|" || node.l === "‖") {
      elements.push({ type: "line", x1: delimW / 2, y1: topY, x2: delimW / 2, y2: botY, width: barThickness, color, blockId });
    } else {
      const midY = (topY + botY) / 2;
      elements.push(
        { type: "line", x1: delimW, y1: topY, x2: 0, y2: midY, width: barThickness, color, blockId },
        { type: "line", x1: 0, y1: midY, x2: delimW, y2: botY, width: barThickness, color, blockId }
      );
    }
    curX += delimW + size * 0.1;
  }

  elements.push(...shiftElements(c.elements, curX, 0));
  curX += c.width + size * 0.1;

  if (node.r) {
    if (node.r === "]" || node.r === "}") {
      elements.push(
        { type: "line", x1: curX, y1: topY, x2: curX + delimW, y2: topY, width: barThickness, color, blockId },
        { type: "line", x1: curX + delimW, y1: topY, x2: curX + delimW, y2: botY, width: barThickness, color, blockId },
        { type: "line", x1: curX + delimW, y1: botY, x2: curX, y2: botY, width: barThickness, color, blockId }
      );
    } else if (node.r === "|" || node.r === "‖") {
      elements.push({ type: "line", x1: curX + delimW / 2, y1: topY, x2: curX + delimW / 2, y2: botY, width: barThickness, color, blockId });
    } else {
      const midY = (topY + botY) / 2;
      elements.push(
        { type: "line", x1: curX, y1: topY, x2: curX + delimW, y2: midY, width: barThickness, color, blockId },
        { type: "line", x1: curX + delimW, y1: midY, x2: curX, y2: botY, width: barThickness, color, blockId }
      );
    }
    curX += delimW;
  }

  return {
    width: curX,
    ascent: -topY,
    descent: botY,
    elements,
  };
}

/**
 * Layout a LaTeX math expression as a 2D box of pen-stroke text and line elements.
 */
export function layoutMath2D(
  latex: string,
  opts: {
    size: number;
    color?: string;
    blockId?: string;
  }
): Math2DBox {
  const ast = parseLatex(latex);
  const color = opts.color ?? "#1a1a1a";
  return layoutNode(ast, opts.size, color, opts.blockId);
}
