import type { Point, Stroke } from "@/lib/document/types";

/** Distance from point p to segment ab. */
export function distToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Does the polyline of `stroke` pass within `radius` of point (x, y)?
 * Fast bounding-box rejection first.
 */
export function strokeHitsPoint(stroke: Stroke, x: number, y: number, radius: number): boolean {
  const bb = strokeBounds(stroke);
  if (
    x < bb.minX - radius || x > bb.maxX + radius ||
    y < bb.minY - radius || y > bb.maxY + radius
  ) return false;
  const pts = stroke.points;
  const r = radius + stroke.width / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    if (distToSegment(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <= r) return true;
  }
  if (pts.length === 1) return Math.hypot(x - pts[0].x, y - pts[0].y) <= r;
  return false;
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  const p: Point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  if (a.pressure !== undefined && b.pressure !== undefined) p.pressure = a.pressure + (b.pressure - a.pressure) * t;
  if (a.time !== undefined && b.time !== undefined) p.time = a.time + (b.time - a.time) * t;
  return p;
}

/** Parameter interval [t0, t1] ⊂ [0, 1] of segment ab lying strictly inside the circle, or null. */
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

/**
 * Cut the part of `stroke` covered by an eraser circle at (x, y). Returns the
 * remaining point runs (possibly empty: fully erased), or null when the eraser
 * doesn't touch the stroke. Cuts are interpolated exactly on the circle edge,
 * widened by half the stroke width so no ink is left under the eraser.
 */
export function splitStrokeByCircle(stroke: Stroke, x: number, y: number, radius: number): Point[][] | null {
  if (!strokeHitsPoint(stroke, x, y, radius)) return null;
  const pts = stroke.points;
  const r = radius + stroke.width / 2;
  if (pts.length === 1) return [];
  const pieces: Point[][] = [];
  let cur: Point[] = [];
  let cut = false;
  const flush = () => {
    if (cur.length > 1) pieces.push(cur);
    cur = [];
  };
  if (Math.hypot(pts[0].x - x, pts[0].y - y) >= r) cur.push(pts[0]);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const hit = segmentInsideCircle(a, b, x, y, r);
    if (!hit) {
      cur.push(b);
      continue;
    }
    cut = true;
    if (hit[0] > 0) cur.push(lerpPoint(a, b, hit[0]));
    flush();
    if (hit[1] < 1) cur = [lerpPoint(a, b, hit[1]), b];
  }
  flush();
  return cut ? pieces.filter((p) => polylineLength(p) >= 0.5) : null;
}

function polylineLength(pts: Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

export function strokeBounds(stroke: Stroke): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const pad = stroke.width / 2;
  for (const p of stroke.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export type Rect = { x: number; y: number; w: number; h: number };

/** Stroke intersects rect if its bounds overlap and any segment/point enters the rect. */
export function strokeIntersectsRect(stroke: Stroke, r: Rect): boolean {
  const bb = strokeBounds(stroke);
  if (bb.maxX < r.x || bb.minX > r.x + r.w || bb.maxY < r.y || bb.minY > r.y + r.h) return false;
  const pts = stroke.points;
  const inside = (p: Point) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  for (const p of pts) if (inside(p)) return true;
  // segment crossing the rect with both endpoints outside
  for (let i = 0; i < pts.length - 1; i++) {
    if (segmentIntersectsRect(pts[i], pts[i + 1], r)) return true;
  }
  return false;
}

function segmentIntersectsRect(a: Point, b: Point, r: Rect): boolean {
  // Liang–Barsky clip test
  const x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - x1, x2 - a.x, a.y - y1, y2 - a.y];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

/**
 * Ramer–Douglas–Peucker simplification in place-safe form.
 * Keeps pressure/time of retained points.
 */
export function simplifyPoints(points: Point[], epsilon = 0.5): Point[] {
  if (points.length <= 2) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxD = 0, index = -1;
    const a = points[first], b = points[last];
    for (let i = first + 1; i < last; i++) {
      const d = distToSegment(points[i].x, points[i].y, a.x, a.y, b.x, b.y);
      if (d > maxD) { maxD = d; index = i; }
    }
    if (maxD > epsilon && index > 0) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Ray-casting point-in-polygon (polygon given as an implicitly closed ring). */
export function pointInPolygon(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Lasso hit test: a stroke is selected when any of its points lies inside the
 * loop, or when the loop encloses the stroke's bounding-box centre.
 */
export function strokeInLasso(stroke: Stroke, poly: { x: number; y: number }[]): boolean {
  if (poly.length < 3) return false;
  if (stroke.points.some((p) => pointInPolygon(p.x, p.y, poly))) return true;
  const b = strokeBounds(stroke);
  return pointInPolygon((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, poly);
}

export function polygonBounds(poly: { x: number; y: number }[]): Rect {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
