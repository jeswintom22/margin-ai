/**
 * Single-stroke "pen" lettering for AI-written text.
 *
 * Glyphs come from lib/drawing/glyphs.json (EMS Readability + Hershey Greek,
 * em units, baseline y=0, y down), plus hand-drawn math symbols below.
 * Text is laid out as polylines and stroked like real ink, with small,
 * deterministic per-glyph jitter (seeded by the element id) so it reads as
 * handwriting rather than a font — identical on every repaint and export.
 *
 * Pure geometry (no DOM) except `drawStrokeText`, so metrics work in tests.
 */
import data from "./glyphs.json";

type Glyph = { a: number; s: number[][] };
const BASE = (data as { glyphs: Record<string, Glyph> }).glyphs;

/** Approximate cap height in em (for symbol design + math layout). */
export const CAP_HEIGHT = (data as { capHeight: number }).capHeight; // ≈ 0.65
export const X_HEIGHT = 0.48;
/** Math axis (fraction bar / minus height) above the baseline, in em. */
export const AXIS = 0.29;

const circle = (cx: number, cy: number, r: number, n = 14) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [cx + Math.cos(t) * r, cy + Math.sin(t) * r];
  }).flat();

/** Hand-drawn symbols the fonts lack (em units, y down, baseline 0). */
const EXTRA: Record<string, Glyph> = {
  "√": { a: 0.56, s: [[0.04, -0.3, 0.13, -0.35, 0.26, 0.02, 0.52, -0.74]] },
  "≤": { a: 0.56, s: [[0.46, -0.56, 0.08, -0.4, 0.46, -0.24], [0.08, -0.08, 0.46, -0.08]] },
  "≥": { a: 0.56, s: [[0.1, -0.56, 0.48, -0.4, 0.1, -0.24], [0.1, -0.08, 0.48, -0.08]] },
  "≠": { a: 0.56, s: [[0.08, -0.38, 0.48, -0.38], [0.08, -0.2, 0.48, -0.2], [0.37, -0.52, 0.19, -0.06]] },
  "≈": {
    a: 0.56,
    s: [
      [0.07, -0.37, 0.17, -0.43, 0.28, -0.37, 0.38, -0.31, 0.48, -0.37],
      [0.07, -0.21, 0.17, -0.27, 0.28, -0.21, 0.38, -0.15, 0.48, -0.21],
    ],
  },
  "≡": { a: 0.56, s: [[0.08, -0.42, 0.48, -0.42], [0.08, -0.29, 0.48, -0.29], [0.08, -0.16, 0.48, -0.16]] },
  "→": { a: 0.7, s: [[0.06, -0.29, 0.62, -0.29], [0.48, -0.4, 0.62, -0.29, 0.48, -0.18]] },
  "←": { a: 0.7, s: [[0.08, -0.29, 0.64, -0.29], [0.22, -0.4, 0.08, -0.29, 0.22, -0.18]] },
  "⇒": { a: 0.72, s: [[0.06, -0.38, 0.54, -0.38], [0.06, -0.2, 0.54, -0.2], [0.46, -0.5, 0.64, -0.29, 0.46, -0.08]] },
  "⇔": {
    a: 0.8,
    s: [[0.2, -0.38, 0.6, -0.38], [0.2, -0.2, 0.6, -0.2], [0.54, -0.5, 0.72, -0.29, 0.54, -0.08], [0.26, -0.5, 0.08, -0.29, 0.26, -0.08]],
  },
  "−": { a: 0.56, s: [[0.08, -0.29, 0.48, -0.29]] },
  "∓": { a: 0.56, s: [[0.08, -0.46, 0.48, -0.46], [0.28, -0.4, 0.28, -0.04], [0.08, -0.22, 0.48, -0.22]] },
  "✓": { a: 0.66, s: [[0.06, -0.3, 0.23, -0.06, 0.6, -0.64]] },
  "✗": { a: 0.6, s: [[0.08, -0.58, 0.5, -0.04], [0.5, -0.58, 0.08, -0.04]] },
  "∞": {
    a: 0.78,
    s: [
      Array.from({ length: 33 }, (_, i) => {
        const t = (i / 32) * Math.PI * 2;
        const d = 1 + Math.sin(t) ** 2;
        return [0.39 + (0.32 * Math.cos(t)) / d, -0.29 + (0.32 * Math.sin(t) * Math.cos(t)) / d];
      }).flat(),
    ],
  },
  "∫": { a: 0.42, s: [[0.38, -0.74, 0.31, -0.79, 0.26, -0.72, 0.22, -0.36, 0.18, 0.08, 0.13, 0.15, 0.06, 0.1]] },
  "∑": { a: 0.6, s: [[0.52, -0.66, 0.08, -0.66, 0.34, -0.33, 0.08, 0, 0.52, 0]] },
  "∏": { a: 0.62, s: [[0.06, -0.66, 0.56, -0.66], [0.16, -0.66, 0.16, 0], [0.46, -0.66, 0.46, 0]] },
  "∂": { a: 0.52, s: [[0.14, -0.62, 0.28, -0.68, 0.4, -0.6, 0.44, -0.38, 0.4, -0.12, 0.28, -0.01, 0.15, -0.04, 0.09, -0.16, 0.13, -0.3, 0.26, -0.36, 0.42, -0.3]] },
  "′": { a: 0.2, s: [[0.13, -0.68, 0.08, -0.5]] },
  "…": { a: 0.62, s: [circle(0.1, -0.03, 0.02, 6), circle(0.31, -0.03, 0.02, 6), circle(0.52, -0.03, 0.02, 6)] },
  "⋯": { a: 0.62, s: [circle(0.1, -0.29, 0.02, 6), circle(0.31, -0.29, 0.02, 6), circle(0.52, -0.29, 0.02, 6)] },
  "•": { a: 0.4, s: [circle(0.2, -0.29, 0.07)] },
  "∠": { a: 0.6, s: [[0.5, -0.6, 0.08, 0, 0.54, 0]] },
  "⊥": { a: 0.56, s: [[0.28, -0.62, 0.28, 0], [0.06, 0, 0.5, 0]] },
  "∈": { a: 0.52, s: [[0.46, -0.52, 0.24, -0.52, 0.1, -0.42, 0.08, -0.26, 0.1, -0.12, 0.24, -0.02, 0.46, -0.02], [0.08, -0.27, 0.4, -0.27]] },
  "∇": { a: 0.62, s: [[0.06, -0.66, 0.56, -0.66, 0.31, 0, 0.06, -0.66]] },
};

/** Characters drawn as a shrunken, shifted copy of another glyph. */
const SCRIPT: Record<string, [base: string, dy: number]> = {};
const SUPS = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱˣʸᵃᵇᶜᵈᵉᵏᵐᵗ";
const SUP_BASE = "0123456789+-=()nixyabcdekmt";
const SUBS = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₙᵢₓₐₑₒₖₘₜⱼᵣ";
const SUB_BASE = "0123456789+-=()nixaeokmtjr";
[...SUPS].forEach((c, i) => (SCRIPT[c] = [SUP_BASE[i], -0.42]));
[...SUBS].forEach((c, i) => (SCRIPT[c] = [SUB_BASE[i], 0.16]));
const SCRIPT_SCALE = 0.62;

/** Characters with no glyph fall back to the system handwriting font. */
const FALLBACK_ADV = 0.56;

function rawGlyph(ch: string): Glyph | null {
  return EXTRA[ch] ?? BASE[ch] ?? null;
}

/** Glyph for a character (script forms synthesized), or null if unsupported. */
export function glyphFor(ch: string): Glyph | null {
  const direct = rawGlyph(ch);
  if (direct) return direct;
  const sc = SCRIPT[ch];
  if (sc) {
    const g = rawGlyph(sc[0]);
    if (!g) return null;
    return {
      a: g.a * SCRIPT_SCALE + 0.03,
      s: g.s.map((pl) => pl.map((v, i) => (i % 2 ? v * SCRIPT_SCALE + sc[1] : v * SCRIPT_SCALE + 0.015))),
    };
  }
  if (ch === "\u00a0") return BASE[" "] ?? null;
  return null;
}

export function hasGlyph(ch: string): boolean {
  return glyphFor(ch) !== null;
}

// ---------- handwriting profile (learned from the user's ink) ----------

/** Style knobs mirroring the user's handwriting — see lib/drawing/handStyle.ts. */
export type HandProfile = {
  /** Shear coefficient — positive leans right, like the user's writing. */
  slant: number;
  /** Multiplies glyph advance widths (letter spacing). ~1.0. */
  advanceFactor: number;
  /** Scales wobble/rotation/size/baseline jitter amplitudes. ~1.0. */
  looseness: number;
  /** AI stroke width base, in document units. */
  penWidth: number;
  /** Synthesize ink taper along each stroke (user's pen reports pressure). */
  pressure: boolean;
  /** User's pressure range (p10 / p90), scales the taper. */
  pressureLo: number;
  pressureHi: number;
  /** bodySize multiplier, applied at layout (frozen into element sizes). */
  sizeFactor: number;
};

export const DEFAULT_PROFILE: HandProfile = {
  slant: 0.09,
  advanceFactor: 1,
  looseness: 1,
  penWidth: 2.2,
  pressure: false,
  pressureLo: 0.35,
  pressureHi: 0.95,
  sizeFactor: 1,
};

let current: HandProfile = DEFAULT_PROFILE;
let profileRev = 0;

/** Publish a new handwriting profile. Returns true when anything changed. */
export function setHandProfile(p: HandProfile): boolean {
  for (const k of Object.keys(DEFAULT_PROFILE) as (keyof HandProfile)[]) {
    if (current[k] !== p[k]) {
      current = { ...p };
      profileRev++;
      return true;
    }
  }
  return false;
}

export function getHandProfile(): HandProfile {
  return current;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Advance width of `text` at font size `size` (deterministic, no jitter). */
export function measureStrokeText(text: string, size: number, profile: HandProfile = current): number {
  let w = 0;
  for (const ch of text) w += glyphFor(ch)?.a ?? FALLBACK_ADV;
  return w * size * profile.advanceFactor;
}

// ---------- seeded jitter ----------

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const JITTER = {
  baseline: 0.035, // ± em per glyph
  rotate: 0.045, // ± rad per glyph
  scale: 0.04, // ± fraction per glyph
  advance: 0.025, // ± em per glyph
  wobble: 0.007, // ± em per point
};

export type StrokeText = {
  /** Polylines in page coordinates: [x0, y0, x1, y1, ...]. */
  strokes: number[][];
  /** Characters without a glyph, to draw with a fallback font. */
  fallbacks: { ch: string; x: number; y: number }[];
  width: number;
};

/**
 * Lay out `text` at (x, baseline y) and size `size` as jittered polylines.
 * Same (text, size, seed) → identical output.
 */
export function strokeText(
  text: string,
  x: number,
  y: number,
  size: number,
  seed = "",
  profile: HandProfile = current
): StrokeText {
  const rnd = mulberry32(hashStr(`${seed}|${text}`));
  const j = (amp: number) => (rnd() * 2 - 1) * amp * profile.looseness;
  const strokes: number[][] = [];
  const fallbacks: StrokeText["fallbacks"] = [];
  let pen = 0;
  for (const ch of text) {
    const g = glyphFor(ch);
    if (!g) {
      fallbacks.push({ ch, x: x + pen * size, y });
      pen += FALLBACK_ADV * profile.advanceFactor;
      continue;
    }
    const dy = j(JITTER.baseline);
    const rot = j(JITTER.rotate);
    const sc = 1 + j(JITTER.scale);
    const cx = g.a / 2; // rotate about the glyph's center at x-height/2
    const cy = -X_HEIGHT / 2;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    for (const pl of g.s) {
      const out: number[] = [];
      for (let i = 0; i + 1 < pl.length; i += 2) {
        let gx = (pl[i] - cx) * sc, gy = (pl[i + 1] - cy) * sc;
        [gx, gy] = [gx * cos - gy * sin, gx * sin + gy * cos];
        gx += cx + j(JITTER.wobble);
        gy += cy + dy + j(JITTER.wobble);
        gx -= gy * profile.slant; // lean like the user's hand (gy < 0 above baseline)
        out.push(x + (pen + gx) * size, y + gy * size);
      }
      if (out.length >= 2) strokes.push(out.length === 2 ? [out[0], out[1], out[0] + 0.01, out[1]] : out);
    }
    pen += g.a * profile.advanceFactor + j(JITTER.advance);
  }
  return { strokes, fallbacks, width: pen * size };
}

// ---------- canvas drawing ----------

/** Pen width for lettering at `size` — follows the user's own pen weight. */
export function strokeWidthFor(size: number, bold = false, profile: HandProfile = current): number {
  return clamp(profile.penWidth, 1, 6) * (0.75 + 0.25 * (size / 17)) * (bold ? 1.45 : 1);
}

const cache = new Map<string, StrokeText>();
const CACHE_MAX = 4000;

/**
 * Stroke one polyline with pressure-like taper: thin entry, full body,
 * tapered exit — scaled to the user's measured pressure range.
 */
function drawTapered(ctx: CanvasRenderingContext2D, pl: number[], baseW: number, p: HandProfile) {
  const n = pl.length / 2;
  if (n < 2) return;
  const denom = Math.max(1, n - 1);
  const wAt = (u: number) => {
    const shape = clamp(Math.min(u / 0.15, (1 - u) / 0.15), 0.25, 1);
    return baseW * (0.5 + 0.7 * (p.pressureLo + (p.pressureHi - p.pressureLo) * shape));
  };
  let startPt = 0;
  let runW = wAt(0.5 / denom);
  for (let s = 1; s <= n - 1; s++) {
    const w = wAt((s - 0.5) / denom);
    if (s === n - 1 || Math.abs(w - runW) / runW > 0.12 || s - startPt >= 6) {
      ctx.beginPath();
      ctx.moveTo(pl[startPt * 2], pl[startPt * 2 + 1]);
      for (let k = startPt + 1; k <= s; k++) ctx.lineTo(pl[k * 2], pl[k * 2 + 1]);
      ctx.lineWidth = runW;
      ctx.stroke();
      startPt = s;
      runW = w;
    }
  }
}

/** Draw pen-stroke text on a 2D canvas. Results are cached per element. */
export function drawStrokeText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  opts: { color: string; bold?: boolean; seed?: string; fallbackFont: string; profile?: HandProfile }
) {
  const profile = opts.profile ?? current;
  const key = `${profileRev}|${opts.seed}|${text}|${x}|${y}|${size}`;
  let st = cache.get(key);
  if (!st) {
    st = strokeText(text, x, y, size, opts.seed, profile);
    if (cache.size > CACHE_MAX) cache.clear();
    cache.set(key, st);
  }
  ctx.save();
  ctx.strokeStyle = opts.color;
  ctx.fillStyle = opts.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (profile.pressure) {
    const baseW = strokeWidthFor(size, opts.bold, profile);
    for (const pl of st.strokes) drawTapered(ctx, pl, baseW, profile);
  } else {
    ctx.lineWidth = strokeWidthFor(size, opts.bold, profile);
    ctx.beginPath();
    for (const pl of st.strokes) {
      ctx.moveTo(pl[0], pl[1]);
      for (let i = 2; i + 1 < pl.length; i += 2) ctx.lineTo(pl[i], pl[i + 1]);
    }
    ctx.stroke();
  }
  if (st.fallbacks.length) {
    ctx.font = `${opts.bold ? "700 " : ""}${size}px ${opts.fallbackFont}`;
    ctx.textBaseline = "alphabetic";
    for (const f of st.fallbacks) ctx.fillText(f.ch, f.x, f.y);
  }
  ctx.restore();
}
