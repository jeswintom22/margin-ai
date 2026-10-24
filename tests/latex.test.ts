import { describe, it, expect } from "vitest";
import { parseLatex, toUnicode, latexToSpeech } from "@/lib/math/latex";
import { toUnicodeMath } from "@/lib/math/unicodeMath";

describe("LaTeX → Unicode", () => {
  it.each([
    // the exact failures from the notebook screenshot
    ["x=\\frac{-b\\pm\\sqrt{\\Delta}}{2a}", "x=(-b±√Δ)/2a"],
    ["x=\\frac{-5\\pm\\sqrt{-31}}{4}", "x=(-5±√(-31))/4"],
    ["x = -\\tfrac{5}{4} \\pm \\tfrac{i\\sqrt{31}}{4}", "x = -5/4 ± i√31/4"],
    ["\\dfrac{a+b}{c-d}", "(a+b)/(c-d)"],
    ["\\frac{\\frac{1}{2}}{3}", "1/2/3".replace("1/2/3", "(1/2)/3")],
    ["\\sqrt[3]{x+1}", "³√(x+1)"],
    ["\\left( \\frac{a}{b} \\right)^2", "( a/b )²"],
    ["\\text{area} = \\pi r^2", "area = πr²"],
    ["a_{n+1} = a_n + 2", "aₙ₊₁ = aₙ + 2"],
    ["\\Delta = b^2 - 4ac", "Δ = b² - 4ac"],
    ["x \\leq 3 \\Rightarrow y \\geq 1", "x ≤ 3 ⇒ y ≥ 1"],
    ["\\lim_{x \\to 0} \\frac{\\sin x}{x}", "lim_(x → 0) (sin x)/x"],
  ])("%s → %s", (src, out) => {
    expect(toUnicodeMath(src)).toBe(out);
  });

  it("never leaks LaTeX syntax or command words", () => {
    const corpus = [
      "\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}",
      "\\tfrac{1}{2}mv^2",
      "\\cfrac{1}{1+\\cfrac{1}{x}}",
      "\\int_{0}^{\\infty} e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}",
      "\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}",
      "\\left[ \\frac{x}{y} \\right]",
      "\\mathbf{v} \\cdot \\mathbf{w} = |v||w|\\cos\\theta",
      "\\unknowncommand{x} + \\frac{a}{",
      "\\displaystyle \\frac{d}{dx}\\left(x^{3}\\right) = 3x^{2}",
    ];
    for (const src of corpus) {
      const out = toUnicodeMath(src);
      expect(out, src).not.toMatch(/[\\{}]|frac|sqrt|tfrac|dfrac|left|right|displaystyle/);
    }
  });

  it("parses nested structure", () => {
    const ast = parseLatex("\\frac{1}{\\sqrt{x}}");
    expect(ast.t).toBe("row");
    const f = ast.t === "row" ? ast.c[0] : ast;
    expect(f.t).toBe("frac");
    if (f.t === "frac") expect(toUnicode(f.d)).toBe("√x");
  });
});

describe("LaTeX → speech", () => {
  it("reads fractions, roots and powers", () => {
    expect(latexToSpeech("\\frac{a}{b}")).toBe("a over b");
    expect(latexToSpeech("x^2")).toBe("x to the power 2");
    expect(latexToSpeech("\\frac{-b\\pm\\sqrt{\\Delta}}{2a}")).toBe("minus b plus or minus the square root of delta over 2a");
    expect(latexToSpeech("")).toBe("a mathematical expression");
  });
});
