import type { Element, Point, Stroke } from "@/lib/xdoc/types";

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type Rect = { x: number; y: number; w: number; h: number };

export const EMPTY_BOUNDS: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

export function boundsToRect(b: Bounds): Rect {
  return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
}

export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
}

/** Largest rendered half-width of a stroke (pressure can exceed nominal width). */
function strokePad(s: Stroke): number {
  let w = s.width;
  if (s.widths) for (const x of s.widths) if (x > w) w = x;
  return w / 2;
}

export function strokeBounds(s: Stroke): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of s.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = strokePad(s);
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/**
 * Text bounds are estimated from size and character count (the renderer uses
 * canvas metrics; exact text bounds are refined by the text tool in P3).
 */
export function elementBounds(e: Element): Bounds {
  switch (e.type) {
    case "stroke":
      return strokeBounds(e);
    case "text": {
      const lines = e.text.split("\n");
      const longest = Math.max(1, ...lines.map((l) => l.length));
      return { minX: e.x, minY: e.y, maxX: e.x + longest * e.size * 0.55, maxY: e.y + lines.length * e.size * 1.25 };
    }
    case "image":
    case "tex":
      return { minX: e.x, minY: e.y, maxX: e.x + e.w, maxY: e.y + e.h };
  }
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Does the stroke's ink pass within `radius` of (x, y)? */
export function strokeHitsPoint(s: Stroke, x: number, y: number, radius: number): boolean {
  const bb = strokeBounds(s);
  if (x < bb.minX - radius || x > bb.maxX + radius || y < bb.minY - radius || y > bb.maxY + radius) return false;
  const pts = s.points;
  const r = radius + strokePad(s);
  if (pts.length === 1) return Math.hypot(x - pts[0].x, y - pts[0].y) <= r;
  for (let i = 0; i < pts.length - 1; i++) if (distToSegment(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <= r) return true;
  return false;
}

/** Any element hit at (x, y)? Box elements use their rectangle. */
export function elementHitsPoint(e: Element, x: number, y: number, radius: number): boolean {
  if (e.type === "stroke") return strokeHitsPoint(e, x, y, radius);
  const b = elementBounds(e);
  return x >= b.minX - radius && x <= b.maxX + radius && y >= b.minY - radius && y <= b.maxY + radius;
}

/** Parameter interval of segment ab strictly inside the circle, or null. */
function segmentInsideCircle(a: Point, b: Point, cx: number, cy: number, r: number): [number, number] | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  const fx = a.x - cx, fy = a.y - cy;
  const A = dx * dx + dy * dy;
  const C = fx * fx + fy * fy - r * r;
  if (A === 0) return C < 0 ? [0, 1] : null;
  const B = 2 * (fx * dx + fy * dy);
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return null;
  const sq = Math.sqrt(disc);
  const t0 = Math.max(0, (-B - sq) / (2 * A));
  const t1 = Math.min(1, (-B + sq) / (2 * A));
  return t1 - t0 > 1e-9 ? [t0, t1] : null;
}

export type StrokePiece = { points: Point[]; widths?: number[] };

function polylineLength(pts: Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

/**
 * Cut the part of a stroke under an eraser circle. Returns the remaining runs
 * (empty array: fully erased) or null when the eraser misses. Per-point
 * widths are interpolated at the cut points so pressure is preserved.
 */
export function splitStrokeByCircle(s: Stroke, x: number, y: number, radius: number): StrokePiece[] | null {
  if (!strokeHitsPoint(s, x, y, radius)) return null;
  const pts = s.points;
  const ws = s.widths;
  if (pts.length === 1) return [];
  const r = radius + s.width / 2;
  const pieces: StrokePiece[] = [];
  let cp: Point[] = [];
  let cw: number[] = [];
  let cut = false;
  const push = (p: Point, w: number | undefined) => {
    cp.push(p);
    if (w !== undefined) cw.push(w);
  };
  const flush = () => {
    if (cp.length > 1) pieces.push(ws ? { points: cp, widths: cw } : { points: cp });
    cp = [];
    cw = [];
  };
  const lerp = (i: number, t: number): [Point, number | undefined] => {
    const a = pts[i], b = pts[i + 1];
    return [{ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, ws ? ws[i] + (ws[i + 1] - ws[i]) * t : undefined];
  };
  if (Math.hypot(pts[0].x - x, pts[0].y - y) >= r) push(pts[0], ws?.[0]);
  for (let i = 0; i < pts.length - 1; i++) {
    const hit = segmentInsideCircle(pts[i], pts[i + 1], x, y, r);
    if (!hit) {
      push(pts[i + 1], ws?.[i + 1]);
      continue;
    }
    cut = true;
    if (hit[0] > 0) push(...lerp(i, hit[0]));
    flush();
    if (hit[1] < 1) {
      push(...lerp(i, hit[1]));
      push(pts[i + 1], ws?.[i + 1]);
    }
  }
  flush();
  return cut ? pieces.filter((p) => polylineLength(p.points) >= 0.4) : null;
}

/** Liang–Barsky: does segment ab cross rect r? */
function segmentIntersectsRect(a: Point, b: Point, r: Rect): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - r.x, r.x + r.w - a.x, a.y - r.y, r.y + r.h - a.y];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

export function elementIntersectsRect(e: Element, r: Rect): boolean {
  const rb: Bounds = { minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h };
  if (!boundsOverlap(elementBounds(e), rb)) return false;
  if (e.type !== "stroke") return true;
  const inside = (p: Point) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  if (e.points.some(inside)) return true;
  for (let i = 0; i < e.points.length - 1; i++) if (segmentIntersectsRect(e.points[i], e.points[i + 1], r)) return true;
  return false;
}

/** Ray-casting point-in-polygon (polygon implicitly closed). */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Xournal++ region select: an element is selected when it lies mostly inside the loop. */
export function elementInLasso(e: Element, poly: Point[]): boolean {
  if (poly.length < 3) return false;
  if (e.type === "stroke") {
    const inside = e.points.filter((p) => pointInPolygon(p, poly)).length;
    return inside / e.points.length >= 0.5;
  }
  const b = elementBounds(e);
  return pointInPolygon({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, poly);
}

export function polygonBounds(poly: Point[]): Bounds {
  return poly.reduce<Bounds>((b, p) => ({ minX: Math.min(b.minX, p.x), minY: Math.min(b.minY, p.y), maxX: Math.max(b.maxX, p.x), maxY: Math.max(b.maxY, p.y) }), EMPTY_BOUNDS);
}

/**
 * Ramer–Douglas–Peucker simplification keeping endpoints; widths of retained
 * points are kept so pressure survives.
 */
export function simplify(points: Point[], widths: number[] | undefined, epsilon: number): StrokePiece {
  if (points.length < 3) return widths ? { points, widths } : { points };
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(points[i].x, points[i].y, points[s].x, points[s].y, points[e].x, points[e].y);
      // keep pressure changes too: a point whose width deviates is significant
      const wd = widths ? Math.abs(widths[i] - (widths[s] + widths[e]) / 2) : 0;
      const score = Math.max(d, wd * 2);
      if (score > maxD) { maxD = score; idx = i; }
    }
    if (maxD > epsilon && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const p: Point[] = [], w: number[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) { p.push(points[i]); if (widths) w.push(widths[i]); }
  return widths ? { points: p, widths: w } : { points: p };
}
