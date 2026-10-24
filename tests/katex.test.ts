import { describe, it, expect } from "vitest";
import katex from "katex";

// Mirrors the settings used by components/notebook/MathTex.tsx.
const opts = { trust: false, throwOnError: false, strict: "ignore" as const, maxSize: 20, maxExpand: 200 };

describe("KaTeX safe settings", () => {
  it("renders math and never emits links or scripts from untrusted LaTeX", () => {
    expect(katex.renderToString("\\frac{a}{b}", opts)).toContain("katex");
    const evil = katex.renderToString("\\href{javascript:alert(1)}{x} \\url{javascript:x} \\htmlId{a}{b}", opts);
    expect(evil).not.toMatch(/href="javascript/i);
    expect(evil).not.toContain("<script");
  });

  it("does not throw on invalid input", () => {
    expect(() => katex.renderToString("\\frac{a", opts)).not.toThrow();
  });
});
