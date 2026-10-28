import { describe, it, expect } from "vitest";
import {
  splitStrokeByCircle, strokeBounds, elementBounds, elementIntersectsRect, elementInLasso,
  pointInPolygon, simplify, strokeHitsPoint, elementHitsPoint,
} from "@/lib/engine/geometry";
import type { Stroke, TextEl } from "@/lib/xdoc/types";

const line = (x0: number, x1: number, y = 10, n = 11, widths = false): Stroke => {
  const points = Array.from({ length: n }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / (n - 1), y }));
  return { id: "s", type: "stroke", tool: "pen", color: "#000000", width: 2, points, ...(widths ? { widths: points.map((_, i) => 1 + i * 0.1) } : {}) };
};

describe("bounds & hits", () => {
  it("pads stroke bounds by the widest pressure width", () => {
    const s = { ...line(0, 10), widths: Array(11).fill(1).map((_, i) => (i === 5 ? 6 : 1)) };
    expect(strokeBounds(s).minY).toBe(10 - 3);
  });

  it("hits near the ink and misses away from it", () => {
    expect(strokeHitsPoint(line(0, 100), 50, 12, 2)).toBe(true);
    expect(strokeHitsPoint(line(0, 100), 50, 30, 2)).toBe(false);
  });

  it("box elements hit by rectangle", () => {
    const t: TextEl = { id: "t", type: "text", x: 0, y: 0, text: "hello", font: "sans-serif", size: 10, color: "#000000" };
    expect(elementHitsPoint(t, 5, 5, 0)).toBe(true);
    expect(elementBounds(t).maxY).toBeCloseTo(12.5);
  });
});

describe("splitStrokeByCircle", () => {
  it("returns null when the eraser misses", () => {
    expect(splitStrokeByCircle(line(0, 100), 50, 50, 5)).toBeNull();
  });

  it("splits a line into two pieces with the gap under the eraser", () => {
    const pieces = splitStrokeByCircle(line(0, 100), 50, 10, 5)!;
    expect(pieces).toHaveLength(2);
    expect(pieces[0].points.at(-1)!.x).toBeLessThan(45);
    expect(pieces[1].points[0].x).toBeGreaterThan(55);
  });

  it("keeps widths aligned with points and interpolates at the cut", () => {
    const pieces = splitStrokeByCircle(line(0, 100, 10, 11, true), 50, 10, 5)!;
    for (const p of pieces) expect(p.widths!.length).toBe(p.points.length);
    const cutW = pieces[0].widths!.at(-1)!;
    expect(cutW).toBeGreaterThan(1.3);
    expect(cutW).toBeLessThan(1.5);
  });

  it("fully erases a single-point stroke", () => {
    const dot: Stroke = { ...line(0, 0), points: [{ x: 5, y: 5 }] };
    expect(splitStrokeByCircle(dot, 5, 5, 3)).toEqual([]);
  });
});

describe("selection geometry", () => {
  it("rect intersection catches a segment crossing the rect with no points inside", () => {
    const s: Stroke = { ...line(0, 100), points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] };
    expect(elementIntersectsRect(s, { x: 40, y: 40, w: 20, h: 20 })).toBe(true);
    expect(elementIntersectsRect(s, { x: 40, y: 60, w: 20, h: 20 })).toBe(false);
  });

  it("point in polygon", () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false);
  });

  it("lasso selects strokes mostly inside the loop", () => {
    const loop = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 20 }, { x: 0, y: 20 }];
    expect(elementInLasso(line(0, 100), loop)).toBe(true); // 6/11 points inside
    expect(elementInLasso(line(50, 150), loop)).toBe(false);
  });
});

describe("simplify", () => {
  it("drops collinear points but keeps endpoints and aligned widths", () => {
    const r = simplify(line(0, 100).points, Array(11).fill(1), 0.5);
    expect(r.points).toHaveLength(2);
    expect(r.widths).toEqual([1, 1]);
  });

  it("keeps a point where pressure changes sharply", () => {
    const w = Array(11).fill(1);
    w[5] = 4;
    expect(simplify(line(0, 100).points, w, 0.5).points.length).toBeGreaterThan(2);
  });
});
