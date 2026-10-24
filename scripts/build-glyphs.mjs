/**
 * Build lib/drawing/glyphs.json — single-stroke glyphs for AI "pen" text.
 *
 * Sources (from the `hersheytext` dev dependency):
 *  - EMS Readability (SIL Open Font License, by Sheldon B. Michaels, derived
 *    from Source Sans Pro) for Latin letters, digits, punctuation, Latin-1.
 *  - Hershey "greek" simplex (public domain) for Greek letters.
 *
 * Output format (em units, baseline at y=0, y grows DOWN like the canvas):
 *   { "glyphs": { "<char>": { "a": advance, "s": [[x0,y0,x1,y1,...], ...] } } }
 *
 * Run: npm run glyphs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve("hersheytext/package.json"));
const round = (n) => Math.round(n * 1000) / 1000;

/** Parse an SVG path made of M/L commands into polylines of [x, y] pairs. */
function parsePath(d) {
  const strokes = [];
  let cur = null;
  const re = /([ML])|(-?\d*\.?\d+(?:e-?\d+)?)/gi;
  const nums = [];
  let cmd = "L";
  const flush = () => {
    for (let i = 0; i + 1 < nums.length; i += 2) {
      if (cmd === "M" && i === 0) {
        cur = [];
        strokes.push(cur);
      }
      cur ??= (strokes.push([]), strokes[strokes.length - 1]);
      cur.push([nums[i], nums[i + 1]]);
    }
    nums.length = 0;
  };
  for (const m of d.matchAll(re)) {
    if (m[1]) {
      flush();
      cmd = m[1].toUpperCase();
    } else nums.push(Number(m[2]));
  }
  flush();
  return strokes.filter((s) => s.length > 0);
}

const decode = (u) =>
  u
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const glyphs = {};

// ---- EMS Readability (y up, 1000 units per em) ----
const ems = readFileSync(path.join(pkgDir, "svg_fonts", "EMSReadability.svg"), "utf8");
const defaultAdv = Number(/<font [^>]*horiz-adv-x="([\d.]+)"/.exec(ems)?.[1] ?? 500);
for (const m of ems.matchAll(/<glyph\b([^>]*)\/>/g)) {
  const attrs = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
  if (attrs.unicode === undefined) continue;
  const ch = decode(attrs.unicode);
  if ([...ch].length !== 1) continue;
  const adv = Number(attrs["horiz-adv-x"] ?? defaultAdv) / 1000;
  const s = attrs.d ? parsePath(attrs.d).map((pl) => pl.flatMap(([x, y]) => [round(x / 1000), round(-y / 1000)])) : [];
  glyphs[ch] = { a: round(adv), s };
}

// Cap height of the primary font, to scale Hershey glyphs to match.
const capTop = Math.min(...glyphs["H"].s.flat().filter((_, i) => i % 2 === 1)); // negative (above baseline)
const capH = -capTop;

// ---- Hershey greek simplex (y down, cap top y=1, baseline y=22) ----
const hershey = JSON.parse(readFileSync(path.join(pkgDir, "hersheytext.json"), "utf8"));
const GREEK = {
  a: "α", b: "β", g: "γ", d: "δ", e: "ε", z: "ζ", h: "η", q: "θ", i: "ι", k: "κ", l: "λ", m: "μ",
  n: "ν", x: "ξ", p: "π", r: "ρ", s: "σ", t: "τ", u: "υ", f: "φ", c: "χ", y: "ψ", w: "ω",
  G: "Γ", D: "Δ", Q: "Θ", L: "Λ", X: "Ξ", P: "Π", S: "Σ", F: "Φ", Y: "Ψ", W: "Ω",
};
const H_BASE = 22, H_CAP = 21;
const hs = capH / H_CAP;
for (const [latin, greek] of Object.entries(GREEK)) {
  const g = hershey.greek.chars[latin.charCodeAt(0) - 33];
  if (!g?.d) continue;
  const s = parsePath(g.d).map((pl) => pl.flatMap(([x, y]) => [round(x * hs), round((y - H_BASE) * hs)]));
  glyphs[greek] = { a: round(2 * g.o * hs), s };
}

const out = {
  license:
    "Latin glyphs: EMS Readability, SIL Open Font License 1.1 (Sheldon B. Michaels; derived from Source Sans Pro by Paul D. Hunt, Adobe). Greek glyphs: Hershey fonts (public domain). Converted via the hersheytext package (MIT).",
  capHeight: round(capH),
  glyphs,
};
const dest = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "lib", "drawing", "glyphs.json");
writeFileSync(dest, JSON.stringify(out));
console.log(`wrote ${Object.keys(glyphs).length} glyphs → ${dest}`);
