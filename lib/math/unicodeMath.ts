/**
 * Convert LaTeX/plain math to readable linear Unicode for handwriting text on
 * the page (x^2 → x², \frac{a}{b} → a/b, \int → ∫, sqrt → √). Backed by a
 * real parser (lib/math/latex.ts), so nested braces and \tfrac/\dfrac work and
 * the output never contains raw LaTeX syntax.
 */
import { parseLatex, toUnicode } from "./latex";

export function toUnicodeMath(src: string): string {
  return toUnicode(parseLatex(src));
}
