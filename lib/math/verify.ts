import { safeParse, safeDerivative, evalReal, normalizeExpr, MathInputError } from "./safeMath";
import type { EvalFunction, MathNode } from "mathjs";

/**
 * Deterministic verification by numeric sampling. "verified" means both sides
 * agreed at every valid sample point; "mismatch" means a valid sample point
 * disagreed; "unknown" means input could not be parsed or too few points were
 * evaluable (e.g. division by zero everywhere sampled). Never a model opinion.
 */

export type VerifyStatus = "verified" | "mismatch" | "unknown";

// Fixed sample points (deterministic, avoid 0/±1/integers where poles cluster).
const SAMPLES = [-2.73, -1.61, -0.77, 0.37, 0.91, 1.43, 2.19, 3.07];
const MIN_VALID = 4;

function close(a: number, b: number) {
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}

function compareFns(a: EvalFunction, b: EvalFunction, v = "x"): VerifyStatus {
  let valid = 0;
  for (const s of SAMPLES) {
    const scope = { [v]: s, y: s * 0.5 + 0.3, t: s };
    const ra = evalReal(a, scope);
    const rb = evalReal(b, scope);
    if (ra === null || rb === null) continue;
    valid++;
    if (!close(ra, rb)) return "mismatch";
  }
  return valid >= MIN_VALID ? "verified" : "unknown";
}

function compile(src: string | MathNode): EvalFunction | null {
  try {
    return (typeof src === "string" ? safeParse(src) : src).compile();
  } catch (e) {
    if (e instanceof MathInputError) return null;
    return null;
  }
}

/** Are two expressions equivalent (e.g. x^2+2x+1 vs (x+1)^2)? */
export function verifyEquivalent(a: string, b: string, v = "x"): VerifyStatus {
  const fa = compile(a), fb = compile(b);
  return fa && fb ? compareFns(fa, fb, v) : "unknown";
}

/** Is `claim` the derivative of `f` w.r.t. `v`? */
export function verifyDerivative(f: string, claim: string, v = "x"): VerifyStatus {
  let d: MathNode;
  try {
    d = safeDerivative(f, v);
  } catch {
    return "unknown";
  }
  const fd = compile(d), fc = compile(claim);
  return fd && fc ? compareFns(fd, fc, v) : "unknown";
}

/** Numeric evaluation claim, e.g. "2^10" = "1024". */
export function verifyNumeric(expr: string, claimed: string): VerifyStatus {
  const fa = compile(expr), fb = compile(claimed);
  if (!fa || !fb) return "unknown";
  const ra = evalReal(fa, {}), rb = evalReal(fb, {});
  if (ra === null || rb === null) return "unknown";
  return close(ra, rb) ? "verified" : "mismatch";
}

type ParsedLine =
  | { kind: "def"; name: string; primes: number; v: string; expr: string }
  | { kind: "eq"; lhs: string; rhs: string }
  | null;

const DEF_RE = /^\s*([a-zA-Z])\s*('{0,3}|′{0,3})\s*\(\s*([a-z])\s*\)\s*=\s*(.+)$/;

export function parseLine(line: string): ParsedLine {
  const s = normalizeExpr(line);
  const m = DEF_RE.exec(s);
  if (m) return { kind: "def", name: m[1], primes: m[2].length, v: m[3], expr: m[4] };
  const parts = s.split("=");
  if (parts.length === 2 && parts[0].trim() && parts[1].trim()) return { kind: "eq", lhs: parts[0], rhs: parts[1] };
  return null;
}

/**
 * Verify each line of student work in context. Function definitions are
 * remembered so "g'(x) = 12x" is checked against an earlier "g(x) = 6x^2";
 * a repeated definition is checked for equivalence (a simplification step).
 */
export function verifyLines(lines: string[]): VerifyStatus[] {
  const defs = new Map<string, string[]>(); // name -> [f, f', f'', ...] expressions
  return lines.map((line) => {
    const p = parseLine(line);
    if (!p) return "unknown";
    if (p.kind === "eq") return verifyEquivalent(p.lhs, p.rhs);
    const chain = defs.get(p.name) ?? [];
    let status: VerifyStatus = "unknown";
    if (chain[p.primes]) status = verifyEquivalent(chain[p.primes], p.expr, p.v);
    else if (p.primes > 0 && chain[p.primes - 1]) status = verifyDerivative(chain[p.primes - 1], p.expr, p.v);
    // Only extend the chain with work that didn't fail verification.
    if (status !== "mismatch" && !chain[p.primes]) chain[p.primes] = p.expr;
    defs.set(p.name, chain);
    return status;
  });
}
