import { describe, it, expect } from "vitest";
import { layoutMath2D } from "@/lib/math/layoutMath2D";
import { formatMathInText } from "@/lib/math/unicodeMath";

describe("layoutMath2D", () => {
  it("renders a 2D fraction with a fraction bar line and pen-stroke text", () => {
    const box = layoutMath2D("\\frac{a}{b}", { size: 18, color: "#1a1a1a", blockId: "b1" });
    expect(box.width).toBeGreaterThan(0);
    expect(box.ascent).toBeGreaterThan(0);
    expect(box.descent).toBeGreaterThan(0);

    const lines = box.elements.filter((e) => e.type === "line");
    const texts = box.elements.filter((e) => e.type === "text");

    expect(lines).toHaveLength(1); // the horizontal fraction bar
    expect(lines[0].width).toBeGreaterThanOrEqual(1);
    expect(lines[0].color).toBe("#1a1a1a");

    expect(texts).toHaveLength(2); // "a" and "b"
    expect(texts.every((t) => t.font === "hand")).toBe(true);
    expect(texts.every((t) => t.color === "#1a1a1a")).toBe(true);

    const num = texts.find((t) => t.text === "a")!;
    const den = texts.find((t) => t.text === "b")!;

    // Numerator is positioned above fraction bar (relY is negative)
    // Denominator is positioned below fraction bar (relY is positive)
    expect(num.relY).toBeLessThan(lines[0].y1);
    expect(den.relY).toBeGreaterThan(lines[0].y1);
  });

  it("renders the quadratic formula with real 2D radical and fraction", () => {
    const box = layoutMath2D("x = \\frac{-b \\pm \\sqrt{\\Delta}}{2a}", {
      size: 18,
      color: "#2563eb",
      blockId: "b2",
    });

    const lines = box.elements.filter((e) => e.type === "line");
    const texts = box.elements.filter((e) => e.type === "text");

    // Fraction bar + radical strokes (vinculum and hook lines)
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.every((l) => l.color === "#2563eb")).toBe(true);

    // All text uses handwriting font and the passed color
    expect(texts.every((t) => t.font === "hand")).toBe(true);
    expect(texts.every((t) => t.color === "#2563eb")).toBe(true);

    // Symbols exist
    const textStrings = texts.map((t) => t.text);
    expect(textStrings).toContain("x");
    expect(textStrings).toContain("=");
    expect(textStrings).toContain("±");
    expect(textStrings).toContain("Δ");
  });

  it("renders powers and subscripts correctly", () => {
    const box = layoutMath2D("a_n = x^2 + 1", { size: 18, color: "#000" });
    const texts = box.elements.filter((e) => e.type === "text");

    const sup = texts.find((t) => t.text === "2")!;
    const base = texts.find((t) => t.text === "x")!;

    // Superscript '2' is smaller and lifted above the baseline
    expect(sup.size).toBeLessThan(base.size);
    expect(sup.relY).toBeLessThan(base.relY);
  });
});

describe("formatMathInText", () => {
  it("converts $...$ blocks to clean unicode math", () => {
    expect(formatMathInText("The answer is $\\frac{1}{2}$")).toBe("The answer is 1/2");
    expect(formatMathInText("Formula: $x^2 + y^2 = r^2$")).toBe("Formula: x² + y² = r²");
  });

  it("converts bare \\frac without dollar signs so 'frac' never leaks", () => {
    expect(formatMathInText("Multiply by \\frac{3}{4} now")).toBe("Multiply by 3/4 now");
    expect(formatMathInText("We have \\tfrac{a+b}{2}")).toBe("We have (a+b)/2");
  });

  it("converts bare symbols like \\pm, \\times, \\theta", () => {
    expect(formatMathInText("Angle is \\theta = 45\\degree")).toBe("Angle is θ = 45°");
    expect(formatMathInText("Result: 5 \\pm 2 \\times 3")).toBe("Result: 5 ± 2 × 3");
  });

  it("removes leftover braces and backslashes", () => {
    expect(formatMathInText("\\text{hello} \\alpha")).toBe("hello α");
    expect(formatMathInText("No \\left or \\right leak")).not.toContain("\\");
  });
});
