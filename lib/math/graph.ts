import { safeCompile, evalReal, MathInputError } from "./safeMath";

/**
 * Deterministic function sampling for graph blocks. The model only names the
 * expression; every point is computed here from the whitelisted parser.
 * NaN/±Infinity samples break the curve, and large jumps (poles) split it
 * into separate segments instead of drawing a vertical line.
 */

export const MAX_SAMPLES = 400;

export type Curve = { label: string; segments: [number, number][][] };

export function sampleExpression(expr: string, xRange: [number, number], samples = 240): [number, number][][] {
  const n = Math.min(Math.max(8, Math.floor(samples)), MAX_SAMPLES);
  const fn = safeCompile(expr);
  const [a, b] = xRange;
  const segments: [number, number][][] = [];
  let cur: [number, number][] = [];
  let prev: number | null = null;
  for (let i = 0; i <= n; i++) {
    const x = a + ((b - a) * i) / n;
    const y = evalReal(fn, { x });
    if (y === null || (prev !== null && Math.abs(y - prev) > 1e6)) {
      if (cur.length > 1) segments.push(cur);
      cur = y === null ? [] : [[x, y]];
      prev = y;
      continue;
    }
    cur.push([x, y]);
    prev = y;
  }
  if (cur.length > 1) segments.push(cur);
  return segments;
}

/** Robust y-range from samples (5th–95th percentile, padded), or the given range. */
export function autoYRange(curves: [number, number][][][], given?: [number, number]): [number, number] {
  if (given) return given;
  const ys = curves.flat(2).map((p) => p[1]).sort((p, q) => p - q);
  if (!ys.length) return [-1, 1];
  const lo = ys[Math.floor(ys.length * 0.02)], hi = ys[Math.ceil(ys.length * 0.98) - 1];
  if (hi - lo < 1e-9) return [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

/** "Nice" tick values (1/2/5 × 10ⁿ) covering [a, b]. */
export function niceTicks(a: number, b: number, target = 6): number[] {
  const raw = (b - a) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out.slice(0, 20);
}

export function sampleCurves(
  exprs: { expr: string; label?: string }[],
  xRange: [number, number]
): { curves: Curve[]; errors: string[] } {
  const curves: Curve[] = [];
  const errors: string[] = [];
  for (const e of exprs) {
    try {
      curves.push({ label: e.label ?? e.expr, segments: sampleExpression(e.expr, xRange) });
    } catch (err) {
      errors.push(`${e.label ?? e.expr}: ${err instanceof MathInputError ? err.message : "could not be plotted"}`);
    }
  }
  return { curves, errors };
}
