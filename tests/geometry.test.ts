import { describe, it, expect } from "vitest";
import {
  distToSegment,
  strokeHitsPoint,
  strokeIntersectsRect,
  simplifyPoints,
} from "@/lib/drawing/geometry";
import { createStroke, type Point } from "@/lib/document/types";

const line = (pts: Point[]) =>
  createStroke(pts, { color: "#000", width: 2, tool: "pen" });

describe("distToSegment", () => {
  it("measures perpendicular distance", () => {
    expect(distToSegment(5, 5, 0, 0, 10, 0)).toBeCloseTo(5);
  });
  it("clamps to endpoints", () => {
    expect(distToSegment(-3, 4, 0, 0, 10, 0)).toBeCloseTo(5);
  });
});

describe("strokeHitsPoint", () => {
  const s = line([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ]);

  it("hits near the path", () => {
    expect(strokeHitsPoint(s, 50, 3, 5)).toBe(true);
    expect(strokeHitsPoint(s, 97, 50, 5)).toBe(true);
  });

  it("misses far points", () => {
    expect(strokeHitsPoint(s, 50, 50, 5)).toBe(false);
    expect(strokeHitsPoint(s, 200, 200, 5)).toBe(false);
  });

  it("respects stroke width", () => {
    const thick = createStroke(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      { color: "#000", width: 20, tool: "pen" }
    );
    expect(strokeHitsPoint(thick, 50, 9, 0)).toBe(true);
    expect(strokeHitsPoint(thick, 50, 15, 0)).toBe(false);
  });
});

describe("strokeIntersectsRect", () => {
  const s = line([
    { x: 0, y: 0 },
    { x: 100, y: 100 },
  ]);

  it("detects overlap", () => {
    expect(strokeIntersectsRect(s, { x: 40, y: 40, w: 20, h: 20 })).toBe(true);
  });

  it("detects segment crossing with endpoints outside", () => {
    expect(strokeIntersectsRect(s, { x: 45, y: 40, w: 10, h: 20 })).toBe(true);
  });

  it("rejects disjoint rects", () => {
    expect(strokeIntersectsRect(s, { x: 60, y: 0, w: 20, h: 20 })).toBe(false);
  });
});

describe("simplifyPoints", () => {
  it("keeps endpoints", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 0.1 },
      { x: 10, y: 0 },
    ];
    const out = simplifyPoints(pts, 0.5);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[2]);
    expect(out.length).toBe(2);
  });

  it("preserves curvature", () => {
    const pts: Point[] = [];
    for (let i = 0; i <= 20; i++) {
      pts.push({ x: i * 5, y: Math.sin(i / 3) * 20 });
    }
    const out = simplifyPoints(pts, 0.4);
    expect(out.length).toBeGreaterThan(4);
    expect(out.length).toBeLessThan(pts.length);
  });
});
