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
