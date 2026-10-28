import { describe, expect, it } from "vitest";
import {
  computeLayout, fitWidthScale, fitPageScale, visiblePages, centerPage, pageAt, toPagePoint, anchoredScroll,
  zoomToScale, PAGE_GAP,
} from "@/lib/engine/layout";
import { PAGE_SIZES } from "@/lib/xdoc/units";

const A4 = PAGE_SIZES.A4;
const pages = (n: number) => Array.from({ length: n }, () => A4);

describe("layout", () => {
  it("stacks pages vertically, centered, with gaps", () => {
    const l = computeLayout(pages(3), "vertical", 1, 1000);
    expect(l.boxes[1].y).toBeCloseTo(PAGE_GAP * 2 + A4.height);
    expect(l.boxes[0].x).toBeCloseTo((1000 - A4.width) / 2);
    expect(l.height).toBeCloseTo(PAGE_GAP * 4 + A4.height * 3);
  });

  it("dual puts two pages per row", () => {
    const l = computeLayout(pages(3), "dual", 1, 100);
    expect(l.boxes[0].y).toBe(l.boxes[1].y);
    expect(l.boxes[2].y).toBeGreaterThan(l.boxes[1].y);
    expect(l.boxes[1].x).toBeCloseTo(l.boxes[0].x + A4.width + PAGE_GAP);
  });

  it("horizontal lays pages side by side", () => {
    const l = computeLayout(pages(2), "horizontal", 1, 100);
    expect(l.boxes[1].x).toBeCloseTo(PAGE_GAP * 2 + A4.width);
    expect(l.boxes[0].y).toBe(l.boxes[1].y);
  });

  it("fit width / fit page scales", () => {
    const s = fitWidthScale(pages(1), "vertical", 1000);
    expect(A4.width * s + 2 * PAGE_GAP).toBeCloseTo(1000);
    const f = fitPageScale(A4, 1000, 600);
    expect(A4.height * f + 2 * PAGE_GAP).toBeCloseTo(600);
  });

  it("visible pages are virtualized to the viewport", () => {
    const l = computeLayout(pages(200), "vertical", zoomToScale(1), 1200);
    const vis = visiblePages(l, { left: 0, top: l.boxes[100].y, width: 1200, height: 800 });
    expect(vis).toContain(100);
    expect(vis.length).toBeLessThanOrEqual(3);
    expect(centerPage(l, { left: 0, top: l.boxes[100].y, width: 1200, height: 800 })).toBe(100);
  });

  it("maps content px to page points", () => {
    const l = computeLayout(pages(2), "vertical", 2, 2000);
    const b = l.boxes[1];
    expect(pageAt(l, b.x + 10, b.y + 10)).toBe(1);
    expect(toPagePoint(l, 1, b.x + 20, b.y + 40)).toEqual({ x: 10, y: 20 });
    expect(pageAt(l, 0, 0)).toBe(-1);
  });

  it("anchored zoom keeps the point under the cursor fixed", () => {
    const vp = { left: 0, top: 3000, width: 1000, height: 800 };
    const before = computeLayout(pages(10), "vertical", 1, 1000);
    const after = computeLayout(pages(10), "vertical", 2, 1000);
    const { left, top } = anchoredScroll(before, after, vp, 400, 300);
    const i = pageAt(before, 400, 3300);
    const pt = toPagePoint(before, i, 400, 3300);
    const back = toPagePoint(after, i, left + 400, top + 300);
    expect(back.x).toBeCloseTo(pt.x);
    expect(back.y).toBeCloseTo(pt.y);
  });
});
