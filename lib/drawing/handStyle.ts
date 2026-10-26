/**
 * Learns a handwriting style profile from the user's own ink so AI-written
 * text picks up their mannerisms: slant, letter size, spacing, looseness,
 * pen weight, and (when the input device reports it) pressure feel.
 *
 * Pure and deterministic — same strokes → same profile. The profile is
 * derived data: it is computed from the document, never stored in it.
 */
import type { Stroke } from "@/lib/document/types";
import { strokeBounds } from "./geometry";
import { DEFAULT_PROFILE, X_HEIGHT, type HandProfile } from "./strokeFont";

export type { HandProfile } from "./strokeFont";

/** Nominal letter size the font is laid out at (x-height × body size 17). */
const NOMINAL_XH = X_HEIGHT * 17;

const median = (xs: number[]): number => percentile(xs, 0.5);

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type BBox = ReturnType<typeof strokeBounds>;

/** Greedy-cluster strokes into text rows by bbox center-Y. */
function clusterRows(boxes: { b: BBox; s: Stroke }[]): { b: BBox; s: Stroke }[][] {
  const sorted = [...boxes].sort((a, b2) => cy(a.b) - cy(b2.b));
  const heights = sorted.map(({ b }) => b.maxY - b.minY);
  const medH = median(heights) || 20;
  const rows: { b: BBox; s: Stroke }[][] = [];
  let cur: { b: BBox; s: Stroke }[] = [];
  let curY = NaN;
  for (const item of sorted) {
    const y = cy(item.b);
    if (cur.length && Math.abs(y - curY) > Math.max(10, medH * 0.9)) {
      rows.push(cur);
      cur = [];
    }
    cur.push(item);
    curY = cur.length ? cur.reduce((sum, i) => sum + cy(i.b), 0) / cur.length : y;
  }
  if (cur.length) rows.push(cur);
  return rows;
}

const cy = (b: BBox) => (b.minY + b.maxY) / 2;

/**
 * Signed horizontal lean of a stroke: +dx as you rise from bottom to top,
 * normalized by height. Positive = leans right like typical handwriting.
 */
function strokeTilt(s: Stroke, b: BBox): number | null {
  const h = b.maxY - b.minY;
  const w = b.maxX - b.minX;
  if (h < 8 || h < w * 1.4) return null; // need tall strokes (l, t, d, f, k…)
  let top = s.points[0], bot = s.points[0];
  for (const p of s.points) {
    if (p.y < top.y) top = p;
    if (p.y > bot.y) bot = p;
  }
  return clamp((top.x - bot.x) / h, -0.6, 0.7);
}

/** Resample a polyline to n evenly-spaced points (by arc length). */
function resample(pts: { x: number; y: number }[], n: number): { x: number; y: number }[] {
  if (pts.length < 2) return pts;
  const seg: number[] = [0];
  for (let i = 1; i < pts.length; i++) seg.push(seg[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = seg[seg.length - 1];
  if (!total) return [pts[0]];
  const out: { x: number; y: number }[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * total;
    while (j < seg.length - 2 && seg[j + 1] < t) j++;
    const f = seg[j + 1] > seg[j] ? (t - seg[j]) / (seg[j + 1] - seg[j]) : 0;
    out.push({ x: pts[j].x + (pts[j + 1].x - pts[j].x) * f, y: pts[j].y + (pts[j + 1].y - pts[j].y) * f });
  }
  return out;
}

/** RMS deviation of a stroke's resampled points from a smoothed version — the writer's natural wobble. */
function strokeWobble(s: Stroke, height: number): number | null {
  if (s.points.length < 8 || height < 4) return null;
  const r = resample(s.points, 24);
  const win = 2; // 5-point moving average
  let sum = 0;
  for (let i = 0; i < r.length; i++) {
    const lo = Math.max(0, i - win), hi = Math.min(r.length - 1, i + win);
    let mx = 0, my = 0;
    for (let k = lo; k <= hi; k++) {
      mx += r[k].x;
      my += r[k].y;
    }
    sum += (r[i].x - mx / (hi - lo + 1)) ** 2 + (r[i].y - my / (hi - lo + 1)) ** 2;
  }
  return Math.sqrt(sum / r.length) / height;
}

/**
 * Build a HandProfile from user-authored pen strokes (pass the caller's
 * filtered, sampled strokes — e.g. the last ~400). Sparse input → defaults.
 */
export function analyzeHand(strokes: Stroke[]): HandProfile {
  const pens = strokes.filter((s) => s.tool === "pen" && s.points.length >= 2 && s.author === "user");
  if (pens.length < 15) return { ...DEFAULT_PROFILE };

  const boxed = pens.map((s) => ({ s, b: strokeBounds(s) }));
  const rows = clusterRows(boxed);

  const p = { ...DEFAULT_PROFILE };

  // --- pen weight ---
  p.penWidth = clamp(median(pens.map((s) => s.width)), 1, 5);

  // --- slant: median lean of tall strokes ---
  const tilts = boxed.map(({ s, b }) => strokeTilt(s, b)).filter((v): v is number => v !== null);
  if (tilts.length >= 6) p.slant = clamp(median(tilts), -0.1, 0.35);

  // --- letter size: 40th percentile of in-row stroke heights ≈ x-height ---
  const letterHs = rows
    .flat()
    .map(({ b }) => b.maxY - b.minY)
    .filter((h) => h >= 5 && h <= 80);
  const xHeight = letterHs.length >= 15 ? percentile(letterHs, 0.4) : 0;
  if (xHeight > 0) p.sizeFactor = clamp(xHeight / NOMINAL_XH, 0.75, 1.5);

  // --- letter spacing: median small gap between same-row neighbors ---
  const gaps: number[] = [];
  for (const row of rows) {
    const sorted = [...row].sort((a, b2) => a.b.minX - b2.b.minX);
    const limit = Math.max(14, (xHeight || medHeight(sorted)) * 1.2);
    for (let i = 1; i < sorted.length; i++) {
      const g = sorted[i].b.minX - sorted[i - 1].b.maxX;
      if (g >= 0 && g <= limit) gaps.push(g);
    }
  }
  if (gaps.length >= 10 && xHeight > 0) {
    p.advanceFactor = clamp(1 + ((median(gaps) - 0.18 * xHeight) / xHeight) * 0.5, 0.85, 1.2);
  }

  // --- looseness: median normalized wobble, scaled so ~2% of height → 1 ---
  const wobbles = boxed.map(({ s, b }) => strokeWobble(s, b.maxY - b.minY)).filter((v): v is number => v !== null);
  if (wobbles.length >= 8) p.looseness = clamp((median(wobbles) / 0.02) * 1.0, 0.4, 2);

  // --- pressure: does the device report meaningful pressure variation? ---
  const ps: number[] = [];
  for (const s of pens) {
    const withP = s.points.filter((pt) => pt.pressure != null);
    if (withP.length >= s.points.length * 0.6) ps.push(...withP.map((pt) => pt.pressure!));
  }
  if (ps.length >= 30) {
    const lo = percentile(ps, 0.1), hi = percentile(ps, 0.9);
    if (hi - lo >= 0.05) {
      p.pressure = true;
      p.pressureLo = clamp(lo, 0.05, 0.9);
      p.pressureHi = clamp(hi, lo + 0.05, 1);
    }
  }

  return p;
}

function medHeight(items: { b: BBox }[]): number {
  return median(items.map(({ b }) => b.maxY - b.minY)) || 20;
}
