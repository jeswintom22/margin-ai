import { describe, it, expect } from "vitest";
import { analyzeHand } from "@/lib/drawing/handStyle";
import { DEFAULT_PROFILE } from "@/lib/drawing/strokeFont";
import type { Stroke, Point } from "@/lib/document/types";

let seq = 0;
const stroke = (points: Point[], opts: { width?: number; tool?: Stroke["tool"]; author?: Stroke["author"] } = {}): Stroke => ({
  id: `s${seq++}`,
  points,
  color: "#000",
  width: opts.width ?? 2.5,
  tool: opts.tool ?? "pen",
  author: opts.author ?? "user",
});

/** A straight stroke from (x,y) to (x2,y2). */
const line = (x: number, y: number, x2: number, y2: number, opts?: Parameters<typeof stroke>[1], n = 6) =>
  stroke(Array.from({ length: n }, (_, i) => ({ x: x + ((x2 - x) * i) / (n - 1), y: y + ((y2 - y) * i) / (n - 1) })), opts);

/** One letter-ish stroke — an "N" path so the bbox is truly w×h (bounds include ink pad). */
const letter = (x: number, y: number, w: number, h: number, opts?: Parameters<typeof stroke>[1]) =>
  stroke([{ x, y }, { x, y: y + h }, { x: x + w, y }, { x: x + w, y: y + h }], opts);

/** A "word" row of n letter-ish strokes starting at (x0,y0), each w×h, spaced `gap` apart. */
function rowOfLetters(n: number, x0: number, y0: number, w: number, h: number, gap: number, opts?: Parameters<typeof stroke>[1]) {
  return Array.from({ length: n }, (_, i) => letter(x0 + i * (w + gap), y0, w, h, opts));
}

describe("analyzeHand — guards", () => {
  it("returns defaults with no strokes", () => {
    expect(analyzeHand([])).toEqual(DEFAULT_PROFILE);
  });
  it("returns defaults with too few strokes", () => {
    expect(analyzeHand(rowOfLetters(8, 0, 0, 6, 16, 4))).toEqual(DEFAULT_PROFILE);
  });
  it("ignores AI-authored strokes", () => {
    const ai = rowOfLetters(20, 0, 0, 6, 16, 4, { author: "ai" });
    expect(analyzeHand(ai)).toEqual(DEFAULT_PROFILE);
  });
  it("is deterministic", () => {
    const s = rowOfLetters(30, 0, 0, 6, 16, 4);
    expect(analyzeHand(s)).toEqual(analyzeHand(s));
  });
});

describe("analyzeHand — pen width and tool filtering", () => {
  it("uses the median pen width and ignores highlighters", () => {
    const pens = rowOfLetters(20, 0, 0, 6, 16, 4, { width: 2 });
    const hl = rowOfLetters(10, 0, 100, 30, 14, 4, { width: 9, tool: "highlighter" });
    expect(analyzeHand([...pens, ...hl]).penWidth).toBeCloseTo(2, 1);
  });
});

describe("analyzeHand — slant", () => {
  it("detects a right lean from tall strokes", () => {
    // Tall strokes rising rightward: bottom (x,100) → top (x+9, 70)
    const s = Array.from({ length: 20 }, (_, i) => line(40 + i * 12, 100, 49 + i * 12, 70));
    expect(analyzeHand(s).slant).toBeGreaterThan(0.15);
  });
  it("near-vertical strokes give ~no slant", () => {
    const s = Array.from({ length: 20 }, (_, i) => line(40 + i * 12, 100, 40 + i * 12, 70));
    expect(Math.abs(analyzeHand(s).slant)).toBeLessThan(0.05);
  });
  it("ignores wide/short strokes when measuring slant", () => {
    // Squiggly wide strokes + a few tall right-leaners → slant reflects the tall ones
    const wide = Array.from({ length: 10 }, (_, i) => line(0, i * 30, 60, i * 30 + 4));
    const tall = Array.from({ length: 12 }, (_, i) => line(80 + i * 12, 100, 89 + i * 12, 70));
    expect(analyzeHand([...wide, ...tall]).slant).toBeGreaterThan(0.15);
  });
});

describe("analyzeHand — letter size", () => {
  it("scales sizeFactor toward the user's letter height (clamped)", () => {
    const big = rowOfLetters(20, 0, 0, 10, 40, 6);
    expect(analyzeHand(big).sizeFactor).toBe(1.5); // (40+pad)/8.16 → clamped
    const small = rowOfLetters(20, 0, 0, 5, 6, 3);
    const f = analyzeHand(small).sizeFactor;
    expect(f).toBeGreaterThan(0.7);
    expect(f).toBeLessThan(1.15);
  });
});

describe("analyzeHand — spacing", () => {
  it("tight letter spacing → advanceFactor < 1", () => {
    const tight = rowOfLetters(25, 0, 0, 6, 16, 3); // near-touching bboxes (ink pad)
    expect(analyzeHand(tight).advanceFactor).toBeLessThan(1);
  });
  it("loose letter spacing → advanceFactor > 1", () => {
    const loose = rowOfLetters(25, 0, 0, 6, 16, 14); // wide gaps (below word-gap cutoff)
    expect(analyzeHand(loose).advanceFactor).toBeGreaterThan(1);
  });
});

describe("analyzeHand — looseness", () => {
  it("wobbly strokes score higher than straight ones", () => {
    const straight = rowOfLetters(20, 0, 0, 6, 16, 4);
    const wobbly = Array.from({ length: 20 }, (_, i) =>
      stroke(
        Array.from({ length: 16 }, (_, k) => ({
          x: i * 20 + k * 2,
          y: 50 + Math.sin(k * 2.4) * 3 + (k % 2 ? 1.5 : -1.5),
        }))
      )
    );
    expect(analyzeHand(wobbly).looseness).toBeGreaterThan(analyzeHand(straight).looseness);
  });
});

describe("analyzeHand — pressure", () => {
  const withPressure = (lo: number, hi: number) =>
    Array.from({ length: 15 }, (_, i) =>
      stroke(
        Array.from({ length: 10 }, (_, k) => ({
          x: i * 15 + k,
          y: 40 + k * 2,
          pressure: lo + ((hi - lo) * k) / 9,
        }))
      )
    );
  it("varying device pressure → taper enabled with measured range", () => {
    const p = analyzeHand(withPressure(0.2, 1));
    expect(p.pressure).toBe(true);
    expect(p.pressureHi).toBeGreaterThan(p.pressureLo);
  });
  it("uniform pressure → taper off", () => {
    expect(analyzeHand(withPressure(0.5, 0.5)).pressure).toBe(false);
  });
  it("no pressure data → taper off", () => {
    expect(analyzeHand(rowOfLetters(20, 0, 0, 6, 16, 4)).pressure).toBe(false);
  });
});
