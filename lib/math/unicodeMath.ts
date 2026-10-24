/**
 * Convert simple LaTeX/plain math to readable Unicode for handwriting-font
 * text on the page (x^2 → x², \frac{a}{b} → a/b, \int → ∫, sqrt → √).
 * Unknown commands lose their backslash; the result never shows raw LaTeX
 * syntax for the supported subset.
 */

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "n": "ⁿ", "i": "ⁱ", "x": "ˣ", "(": "⁽", ")": "⁾",
};
const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "n": "ₙ", "i": "ᵢ", "x": "ₓ",
};
const SYMBOLS: Record<string, string> = {
  int: "∫", sum: "∑", prod: "∏", infty: "∞", pi: "π", theta: "θ", alpha: "α", beta: "β", gamma: "γ",
  delta: "δ", Delta: "Δ", lambda: "λ", mu: "μ", sigma: "σ", omega: "ω", phi: "φ", partial: "∂",
  cdot: "·", times: "×", div: "÷", pm: "±", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠",
  approx: "≈", to: "→", rightarrow: "→", Rightarrow: "⇒", lim: "lim", sin: "sin", cos: "cos",
  tan: "tan", ln: "ln", log: "log", exp: "exp", cdots: "⋯", ldots: "…", quad: " ", qquad: "  ",
};

function mapScript(s: string, table: Record<string, string>, mark: string): string {
  const mapped = [...s].map((c) => table[c]);
  return mapped.every(Boolean) ? mapped.join("") : `${mark}(${s})`;
}

export function toUnicodeMath(src: string): string {
  let s = src;
  // \frac{a}{b} and \dfrac → (a)/(b) when compound, a/b when simple.
  for (let i = 0; i < 4; i++) {
    s = s.replace(/\\d?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a: string, b: string) => {
      const wrap = (t: string) => (/^[\w.]+$/.test(t) ? t : `(${t})`);
      return `${wrap(a)}/${wrap(b)}`;
    });
  }
  s = s
    .replace(/\\sqrt\{([^{}]*)\}/g, (_, a: string) => (/^\w+$/.test(a) ? `√${a}` : `√(${a})`))
    .replace(/\bsqrt\(([^()]*)\)/g, (_, a: string) => (/^\w+$/.test(a) ? `√${a}` : `√(${a})`))
    .replace(/\\(?:text|mathrm|operatorname|mathbf)\{([^{}]*)\}/g, "$1")
    .replace(/\\left|\\right/g, "")
    .replace(/\\([a-zA-Z]+)/g, (_, name: string) => SYMBOLS[name] ?? name)
    .replace(/\^\{([^{}]*)\}/g, (_, a: string) => mapScript(a, SUP, "^"))
    .replace(/\^([0-9a-z+-])/g, (_, a: string) => SUP[a] ?? `^${a}`)
    .replace(/_\{([^{}]*)\}/g, (_, a: string) => mapScript(a, SUB, "_"))
    .replace(/_([0-9a-z])/g, (_, a: string) => SUB[a] ?? `_${a}`)
    .replace(/\*/g, "·")
    .replace(/[{}$]/g, "")
    .replace(/\\,|\\;|\\!|\\ /g, " ")
    .replace(/\s{2,}/g, " ");
  return s.trim();
}
