import { describe, it, expect } from "vitest";
import { verifyDerivative, verifyEquivalent, verifyNumeric, verifyLines, parseLine } from "@/lib/math/verify";
import { safeParse, MathInputError } from "@/lib/math/safeMath";

describe("verify", () => {
  it("verifies correct derivatives and flags wrong ones", () => {
    expect(verifyDerivative("6x^2", "12x")).toBe("verified");
    expect(verifyDerivative("sin(x)", "cos(x)")).toBe("verified");
    expect(verifyDerivative("6x^2", "6x")).toBe("mismatch");
  });

  it("recognizes equivalent forms", () => {
    expect(verifyEquivalent("x^2+2x+1", "(x+1)^2")).toBe("verified");
    expect(verifyEquivalent("x^2+2x+1", "(x+2)^2")).toBe("mismatch");
  });

  it("returns unknown for unparseable or unsafe input", () => {
    expect(verifyEquivalent("x +* ", "x")).toBe("unknown");
    expect(verifyEquivalent("import(1)", "1")).toBe("unknown");
    expect(verifyDerivative("x^2", "foo(x)")).toBe("unknown");
  });

  it("handles division by zero without crashing", () => {
    expect(verifyNumeric("1/0", "1")).toBe("unknown");
    expect(verifyEquivalent("1/(x-x)", "1")).toBe("unknown");
    expect(verifyNumeric("2^10", "1024")).toBe("verified");
    expect(verifyNumeric("2+2", "5")).toBe("mismatch");
  });

  it("verifies student lines in context", () => {
    expect(verifyLines(["g(x) = 6x^2", "g'(x) = 12x"])).toEqual(["unknown", "verified"]);
    expect(verifyLines(["g(x) = 6x^2", "g'(x) = 6x"])).toEqual(["unknown", "mismatch"]);
    expect(verifyLines(["f(x) = (x+1)^2", "f(x) = x^2+2x+1", "3+4 = 7", "hello"]))
      .toEqual(["unknown", "verified", "verified", "unknown"]);
    expect(parseLine("g′(x) = 12x")).toMatchObject({ kind: "def", primes: 1 });
  });

  it("rejects disallowed syntax in the safe parser", () => {
    for (const bad of ["a.b", "f(x)=x", "[1,2]", "\"s\"", "evaluate(\"1\")", "x".repeat(201)])
      expect(() => safeParse(bad)).toThrow(MathInputError);
  });
});
