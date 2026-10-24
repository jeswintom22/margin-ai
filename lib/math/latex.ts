/**
 * Small LaTeX math parser for what models actually emit in answers.
 * Real brace matching (any nesting), so `\frac{-b\pm\sqrt{\Delta}}{2a}` parses
 * correctly. Unknown commands degrade to their name; output never contains
 * leftover `\`, `{`, `}` or command words like "frac".
 *
 * Also accepts plain math ("x^2", "sqrt(x+1)", "6*x^2").
 */

export type MathNode =
  | { t: "sym"; v: string }
  | { t: "space" }
  | { t: "row"; c: MathNode[] }
  | { t: "frac"; n: MathNode; d: MathNode; small: boolean }
  | { t: "sqrt"; c: MathNode; idx?: MathNode }
  | { t: "scripts"; base: MathNode; sup?: MathNode; sub?: MathNode }
  | { t: "delim"; l: string; r: string; c: MathNode }
  | { t: "text"; v: string };

export const SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", vartheta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π",
  rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  int: "∫", iint: "∬", oint: "∮", sum: "∑", prod: "∏", infty: "∞", partial: "∂", nabla: "∇",
  cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", ast: "∗", star: "⋆", circ: "∘", bullet: "•",
  leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈", equiv: "≡", sim: "∼", propto: "∝",
  ll: "≪", gg: "≫", in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", cup: "∪", cap: "∩", emptyset: "∅",
  forall: "∀", exists: "∃", neg: "¬", land: "∧", lor: "∨",
  to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftarrow: "⇐", iff: "⇔", Leftrightarrow: "⇔",
  mapsto: "↦", implies: "⇒", degree: "°", circ_deg: "°", angle: "∠", perp: "⊥", parallel: "∥",
  cdots: "⋯", ldots: "…", dots: "…", vdots: "⋮", prime: "′", lbrace: "{", rbrace: "}",
  langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉", vert: "|", mid: "|",
  // operator names keep their words
  sin: "sin", cos: "cos", tan: "tan", sec: "sec", csc: "csc", cot: "cot", arcsin: "arcsin",
  arccos: "arccos", arctan: "arctan", sinh: "sinh", cosh: "cosh", tanh: "tanh", ln: "ln", log: "log",
  exp: "exp", lim: "lim", max: "max", min: "min", det: "det", gcd: "gcd", mod: "mod", bmod: "mod",
};

/** Binary operators, relations, arrows and big operators: spacing around them is kept. */
const OPERATORS = "±∓×·÷∗⋆∘•≤≥≠≈≡∼∝≪≫∈∉⊂⊆∪∩∧∨¬∀∃→←⇒⇐⇔↦⊥∥∫∬∮∑∏|";

const FRACS = new Set(["frac", "dfrac", "tfrac", "cfrac"]);
const TEXTS = new Set(["text", "mathrm", "operatorname", "mathbf", "mathit", "textbf", "textit", "mathsf", "mathtt", "boldsymbol", "mathbb", "mathcal"]);
const SPACES = new Set([",", ";", ":", "!", " ", "quad", "qquad", "enspace", "thinspace"]);
const IGNORE = new Set(["displaystyle", "textstyle", "limits", "nolimits", "left", "right", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr"]);

class Parser {
  i = 0;
  constructor(private s: string) {}

  private peek(n = 0) {
    return this.s[this.i + n];
  }

  /** Read a command name after "\": letters, or one non-letter char. */
  private command(): string {
    const m = /^[a-zA-Z]+/.exec(this.s.slice(this.i));
    if (m) {
      this.i += m[0].length;
      return m[0];
    }
    return this.s[this.i++] ?? "";
  }

  /** Raw content of a {...} group (for \text). */
  private rawGroup(): string {
    this.skipWs();
    if (this.peek() !== "{") return "";
    let depth = 0, out = "";
    for (; this.i < this.s.length; this.i++) {
      const ch = this.s[this.i];
      if (ch === "{" && depth++ === 0) continue;
      if (ch === "}" && --depth === 0) { this.i++; break; }
      out += ch;
    }
    return out;
  }

  private skipWs() {
    while (this.peek() === " " || this.peek() === "\n" || this.peek() === "\t") this.i++;
  }

  /** A required argument: {group} or a single atom. */
  private arg(): MathNode {
    this.skipWs();
    if (this.peek() === "{") {
      this.i++;
      const r = this.row("}");
      if (this.peek() === "}") this.i++;
      return r;
    }
    return this.atom() ?? { t: "row", c: [] };
  }

  /** Delimiter after \left / \right. */
  private delimiter(): string {
    this.skipWs();
    const ch = this.s[this.i++] ?? "";
    if (ch === "\\") {
      const name = this.command();
      if (name === "{" || name === "}") return name;
      if (name === "|") return "‖";
      return SYMBOLS[name] ?? "";
    }
    return ch === "." ? "" : ch;
  }

  row(stop?: string): MathNode {
    const c: MathNode[] = [];
    while (this.i < this.s.length) {
      const ch = this.peek();
      if (stop && ch === stop) break;
      if (ch === "\\" && /^\\right\b/.test(this.s.slice(this.i))) break;
      if (ch === "^" || ch === "_") {
        // Script with no base (start of group): attach to an empty base.
        const base = c.pop() ?? { t: "sym", v: "" };
        c.push(this.scripts(base));
        continue;
      }
      const a = this.atom();
      if (!a) continue;
      if (this.peek() === "^" || this.peek() === "_") c.push(this.scripts(a));
      else c.push(a);
    }
    return { t: "row", c };
  }

  private scripts(base: MathNode): MathNode {
    const node: Extract<MathNode, { t: "scripts" }> =
      base.t === "scripts" ? base : { t: "scripts", base };
    while (this.peek() === "^" || this.peek() === "_") {
      const kind = this.s[this.i++];
      const a = this.arg();
      if (kind === "^") node.sup = a;
      else node.sub = a;
    }
    return node;
  }

  atom(): MathNode | null {
    const ch = this.peek();
    if (ch === undefined) return null;
    if (ch === " " || ch === "\n" || ch === "\t" || ch === "~") {
      while (/[\s~]/.test(this.peek() ?? "")) this.i++;
      return { t: "space" };
    }
    if (ch === "{") {
      this.i++;
      const r = this.row("}");
      if (this.peek() === "}") this.i++;
      return r;
    }
    if (ch === "}" || ch === "$") {
      this.i++;
      return null;
    }
    if (ch === "\\") {
      this.i++;
      const name = this.command();
      if (FRACS.has(name)) {
        const n = this.arg();
        const d = this.arg();
        return { t: "frac", n, d, small: name === "tfrac" };
      }
      if (name === "sqrt") {
        let idx: MathNode | undefined;
        this.skipWs();
        if (this.peek() === "[") {
          this.i++;
          idx = this.row("]");
          if (this.peek() === "]") this.i++;
        }
        return { t: "sqrt", c: this.arg(), idx };
      }
      if (TEXTS.has(name)) return { t: "text", v: this.rawGroup() };
      if (name === "left") {
        const l = this.delimiter();
        const c = this.row();
        if (/^\\right/.test(this.s.slice(this.i))) {
          this.i += "\\right".length;
          return { t: "delim", l, r: this.delimiter(), c };
        }
        return { t: "delim", l, r: "", c };
      }
      if (name === "right") {
        this.delimiter();
        return null;
      }
      if (SPACES.has(name) || name === "\\") return { t: "space" };
      if (IGNORE.has(name)) return null;
      if (name === "{" || name === "}" || name === "%" || name === "&" || name === "#" || name === "_") return { t: "sym", v: name };
      if (name === "|") return { t: "sym", v: "‖" };
      const v = SYMBOLS[name] ?? name;
      // Whitespace after a symbol command just ends the name ("\pi r" = πr);
      // word-like operators (sin, lim, unknown names) keep their spacing.
      if (/^[a-zA-Z]/.test(name) && !/^[a-zA-Z]/.test(v) && !OPERATORS.includes(v) && /^\s+[a-zA-Z0-9\\(]/.test(this.s.slice(this.i))) {
        this.skipWs();
      }
      return { t: "sym", v };
    }
    // Plain-text sqrt(…) e.g. from model prose or graph labels.
    if (ch === "s" && /^sqrt\(/.test(this.s.slice(this.i)) && !/[a-zA-Z]/.test(this.s[this.i - 1] ?? "")) {
      this.i += 5;
      const c = this.row(")");
      if (this.peek() === ")") this.i++;
      return { t: "sqrt", c };
    }
    this.i++;
    if (ch === "*") return { t: "sym", v: "·" };
    return { t: "sym", v: ch };
  }
}

export function parseLatex(src: string): MathNode {
  return new Parser(src).row();
}

// ---------- linear Unicode ----------

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", x: "ˣ", y: "ʸ", a: "ᵃ", b: "ᵇ",
  c: "ᶜ", d: "ᵈ", e: "ᵉ", k: "ᵏ", m: "ᵐ", t: "ᵗ", "′": "′",
};
const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎", n: "ₙ", i: "ᵢ", x: "ₓ", a: "ₐ", e: "ₑ",
  o: "ₒ", k: "ₖ", m: "ₘ", t: "ₜ", j: "ⱼ", r: "ᵣ",
};

function mapScript(s: string, table: Record<string, string>, mark: string): string {
  if (!s) return "";
  const mapped = [...s].map((ch) => table[ch]);
  if (mapped.every(Boolean)) return mapped.join("");
  return [...s].length === 1 ? `${mark}${s}` : `${mark}(${s})`;
}

/** Does this linear string need parentheses as a fraction/root operand? */
const isCompound = (s: string) => /[\s+\-−±∓×·÷/=<>≤≥≠≈]/.test(s);

function uni(n: MathNode): string {
  switch (n.t) {
    case "sym":
      return n.v;
    case "text":
      return n.v;
    case "space":
      return " ";
    case "row":
      return n.c.map(uni).join("");
    case "frac": {
      const a = uni(n.n).trim(), b = uni(n.d).trim();
      return `${isCompound(a) ? `(${a})` : a}/${isCompound(b) ? `(${b})` : b}`;
    }
    case "sqrt": {
      const c = uni(n.c).trim();
      const idx = n.idx ? mapScript(uni(n.idx).trim(), SUP, "^") : "";
      return `${idx}√${isCompound(c) ? `(${c})` : c}`;
    }
    case "scripts": {
      const base = uni(n.base);
      const sub = n.sub ? mapScript(uni(n.sub).trim(), SUB, "_") : "";
      const sup = n.sup ? mapScript(uni(n.sup).trim(), SUP, "^") : "";
      return base + sub + sup;
    }
    case "delim":
      return `${n.l}${uni(n.c)}${n.r}`;
  }
}

export function toUnicode(n: MathNode): string {
  return uni(n).replace(/\s{2,}/g, " ").trim();
}

// ---------- speech ----------

const SPOKEN: Record<string, string> = {
  "+": "plus", "-": "minus", "−": "minus", "±": "plus or minus", "∓": "minus or plus", "×": "times",
  "·": "times", "÷": "divided by", "=": "equals", "≠": "is not equal to", "≈": "is approximately",
  "<": "is less than", ">": "is greater than", "≤": "is less than or equal to", "≥": "is greater than or equal to",
  "→": "tends to", "⇒": "implies", "∞": "infinity", "∫": "the integral of", "∑": "the sum of",
  "∂": "partial", "π": "pi", "θ": "theta", "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta",
  "Δ": "delta", "λ": "lambda", "μ": "mu", "σ": "sigma", "ω": "omega", "φ": "phi", "°": "degrees",
  "/": "over", "(": "", ")": "",
};

function speak(n: MathNode): string {
  switch (n.t) {
    case "sym":
      return SPOKEN[n.v] !== undefined ? ` ${SPOKEN[n.v]} ` : n.v;
    case "text":
      return ` ${n.v} `;
    case "space":
      return " ";
    case "row":
      return n.c.map(speak).join("");
    case "frac":
      return ` ${speak(n.n)} over ${speak(n.d)} `;
    case "sqrt":
      return n.idx ? ` the ${speak(n.idx)} root of ${speak(n.c)} ` : ` the square root of ${speak(n.c)} `;
    case "scripts": {
      let s = speak(n.base);
      if (n.sub) s += ` sub ${speak(n.sub)}`;
      if (n.sup) s += ` to the power ${speak(n.sup)}`;
      return `${s} `;
    }
    case "delim":
      return ` ${speak(n.c)} `;
  }
}

export function latexToSpeech(src: string): string {
  return speak(parseLatex(src)).replace(/\s+/g, " ").trim() || "a mathematical expression";
}
