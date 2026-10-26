import { describe, it, expect } from "vitest";
import {
  strokeText,
  measureStrokeText,
  strokeWidthFor,
  hasGlyph,
  setHandProfile,
  getHandProfile,
  DEFAULT_PROFILE,
  type HandProfile,
} from "@/lib/drawing/strokeFont";

const prof = (over: Partial<HandProfile> = {}): HandProfile => ({ ...DEFAULT_PROFILE, ...over });

describe("measureStrokeText", () => {
  it("is positive and grows with size", () => {
    const a = measureStrokeText("hello world", 17);
    expect(a).toBeGreaterThan(0);
    expect(measureStrokeText("hello world", 34)).toBeCloseTo(a * 2, 5);
  });
  it("scales with the profile's advanceFactor", () => {
    const base = measureStrokeText("abcdef", 17, prof());
    expect(measureStrokeText("abcdef", 17, prof({ advanceFactor: 1.2 }))).toBeCloseTo(base * 1.2, 5);
  });
  it("still measures unsupported characters (fallback advance)", () => {
    expect(measureStrokeText("\u2603", 17)).toBeGreaterThan(0);
  });
});

describe("strokeText", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a = strokeText("hello", 10, 50, 17, "el1");
    const b = strokeText("hello", 10, 50, 17, "el1");
    const c = strokeText("hello", 10, 50, 17, "el2");
    expect(a.strokes).toEqual(b.strokes);
    expect(a.strokes).not.toEqual(c.strokes);
  });
  it("with looseness 0 the seed no longer matters (no jitter)", () => {
    const a = strokeText("steady hand", 10, 50, 17, "seedA", prof({ looseness: 0 }));
    const b = strokeText("steady hand", 10, 50, 17, "seedB", prof({ looseness: 0 }));
    expect(a.strokes).toEqual(b.strokes);
  });
  it("slant changes glyph geometry", () => {
    const upright = strokeText("llll", 10, 50, 17, "s", prof({ slant: 0, looseness: 0 }));
    const leaning = strokeText("llll", 10, 50, 17, "s", prof({ slant: 0.3, looseness: 0 }));
    expect(leaning.strokes).not.toEqual(upright.strokes);
    // Positive slant pushes the TOP of letters right (y smaller = higher).
    const topX = (st: number[][]) => {
      let minY = Infinity, x = 0;
      for (const pl of st) for (let i = 0; i + 1 < pl.length; i += 2) if (pl[i + 1] < minY) { minY = pl[i + 1]; x = pl[i]; }
      return x;
    };
    expect(topX(leaning.strokes)).toBeGreaterThan(topX(upright.strokes));
  });
  it("wider spacing advances the pen further", () => {
    const tight = strokeText("aaaa", 0, 0, 17, "s", prof({ advanceFactor: 0.9, looseness: 0 }));
    const loose = strokeText("aaaa", 0, 0, 17, "s", prof({ advanceFactor: 1.2, looseness: 0 }));
    expect(loose.width).toBeGreaterThan(tight.width);
  });
  it("routes unsupported characters to the font fallback", () => {
    const st = strokeText("a\u2603b", 0, 0, 17, "s");
    expect(st.fallbacks).toHaveLength(1);
    expect(st.fallbacks[0].ch).toBe("\u2603");
  });
  it("keeps rendered width near the measured width", () => {
    const st = strokeText("a typical answer line", 0, 0, 17, "s");
    const m = measureStrokeText("a typical answer line", 17);
    expect(Math.abs(st.width - m) / m).toBeLessThan(0.1);
  });
});

describe("glyph coverage", () => {
  it("has latin and math glyphs", () => {
    for (const ch of "abcXYZ019") expect(hasGlyph(ch)).toBe(true);
    for (const ch of "√≤≥≠≈→∞✓✗") expect(hasGlyph(ch)).toBe(true);
  });
  it("synthesizes script forms", () => {
    for (const ch of "²³ⁿ₀ᵢ") expect(hasGlyph(ch)).toBe(true);
  });
});

describe("strokeWidthFor", () => {
  it("follows the user's pen weight", () => {
    expect(strokeWidthFor(17, false, prof({ penWidth: 4 }))).toBeCloseTo(4, 3);
    expect(strokeWidthFor(17, false, prof({ penWidth: 1.2 }))).toBeCloseTo(1.2, 3);
  });
  it("bold writes heavier", () => {
    expect(strokeWidthFor(17, true, prof({ penWidth: 2 }))).toBeGreaterThan(strokeWidthFor(17, false, prof({ penWidth: 2 })));
  });
});

describe("setHandProfile", () => {
  it("publishes changes and reports them", () => {
    const before = getHandProfile();
    expect(setHandProfile({ ...before })).toBe(false); // no change
    expect(setHandProfile({ ...before, slant: before.slant + 0.1 })).toBe(true);
    expect(getHandProfile().slant).toBeCloseTo(before.slant + 0.1, 6);
    setHandProfile(DEFAULT_PROFILE); // restore
  });
});
