/**
 * Convert LaTeX/plain math to readable linear Unicode for handwriting text on
 * the page (x^2 → x², \frac{a}{b} → a/b, \int → ∫, sqrt → √). Backed by a
 * real parser (lib/math/latex.ts), so nested braces and \tfrac/\dfrac work and
 * the output never contains raw LaTeX syntax.
 */
import { parseLatex, toUnicode, SYMBOLS } from "./latex";

export function toUnicodeMath(src: string): string {
  return toUnicode(parseLatex(src));
}

/**
 * Cleanly format math inside prose text for handwriting.
 * Converts both $...$ blocks and bare LaTeX formulas/symbols (\frac, \sqrt, \pm, \theta, etc.)
 * into clean, readable Unicode characters so raw LaTeX syntax (like "\frac", braces, backslashes)
 * never leaks onto the notebook page.
 */
export function formatMathInText(src: string): string {
  if (!src) return "";

  // 1. Convert explicit $...$ or $$...$$ math blocks
  let out = src.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$/g, (_, b1, b2) => {
    return toUnicodeMath(b1 || b2);
  });

  // 2. Convert bare fractions (\frac{...}{...}, \tfrac, \dfrac, \cfrac, or even frac{...}{...})
  while (/(?:\\[tdc]?frac|(?<=\s|^)frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/i.test(out)) {
    out = out.replace(
      /(?:\\[tdc]?frac|(?<=\s|^)frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/gi,
      (_, n, d) => toUnicodeMath(`\\frac{${n}}{${d}}`)
    );
  }

  // 3. Convert bare square roots (\sqrt{...} or \sqrt[n]{...})
  while (/(?:\\sqrt|(?<=\s|^)sqrt)(?:\[([^[\]]+)\])?\s*\{([^{}]+)\}/i.test(out)) {
    out = out.replace(
      /(?:\\sqrt|(?<=\s|^)sqrt)(?:\[([^[\]]+)\])?\s*\{([^{}]+)\}/gi,
      (_, idx, c) => toUnicodeMath(idx ? `\\sqrt[${idx}]{${c}}` : `\\sqrt{${c}}`)
    );
  }

  // 4. Convert other bare LaTeX commands (\command) via SYMBOLS
  out = out.replace(/\\([a-zA-Z]+)/g, (match, name) => {
    if (SYMBOLS[name]) return SYMBOLS[name];
    if (name === "times") return "×";
    if (name === "pm") return "±";
    if (name === "mp") return "∓";
    if (name === "cdot") return "·";
    if (name === "degree") return "°";
    if (name === "circ") return "°";
    return match;
  });

  // 5. Clean up any leftover \text{...} or \mathrm{...}
  out = out.replace(/\\(?:text|mathrm|mathbf|mathit)\{([^{}]+)\}/g, "$1");

  // 6. Clean up stray backslashes before special characters
  out = out.replace(/\\([#$%&_])/g, "$1");
  out = out.replace(/\\/g, "");

  return out;
}
