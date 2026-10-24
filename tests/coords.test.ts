import { describe, it, expect } from "vitest";
import { clientToPage, fitScale, fitWidthScale, maxScroll, pageOffset, PAGE_GAP } from "@/lib/drawing/coords";

describe("clientToPage", () => {
  const rect = { left: 100, top: 50, width: 1000, height: 800 };
  const pageW = 800, pageH = 1000;

  it("maps the canvas center to the page center when the page fits", () => {
    const scale = fitScale(rect.width, rect.height, pageW, pageH);
    const p = clientToPage(600, 450, rect, pageW, pageH, scale); // center of 1000x800 at (100,50)
    expect(p.x).toBeCloseTo(pageW / 2);
    expect(p.y).toBeCloseTo(pageH / 2);
  });

  it("round-trips page points through pageOffset at any size and scroll", () => {
    for (const [r, scale, scroll] of [
      [rect, 0.5, 0],
      [{ left: 0, top: 0, width: 400, height: 300 }, 0.9, 0],
      [rect, 1.4, 250],
    ] as const) {
      const o = pageOffset(r.width, r.height, pageW, pageH, scale, scroll);
      const pt = { x: 123, y: 456 };
      const p = clientToPage(r.left + o.x + pt.x * scale, r.top + o.y + pt.y * scale, r, pageW, pageH, scale, scroll);
      expect(p.x).toBeCloseTo(pt.x);
      expect(p.y).toBeCloseTo(pt.y);
    }
  });

  it("top-aligns a tall page and moves it up by scrollY", () => {
    const scale = 1;
    expect(pageOffset(1000, 800, 1000, 800, scale, 0).y).toBe(PAGE_GAP);
    const p = clientToPage(rect.left + 500, rect.top + PAGE_GAP + 100, rect, 1000, 800, scale, 60);
    expect(p.x).toBeCloseTo(500);
    expect(p.y).toBeCloseTo(160);
  });

  it("bounds scrolling and width-fit scaling", () => {
    expect(maxScroll(800, 400, 1)).toBe(0); // fits: no scroll
    expect(maxScroll(800, 1000, 1)).toBe(1000 + PAGE_GAP * 2 - 800);
    expect(fitWidthScale(848, 800)).toBeCloseTo(1);
    expect(fitWidthScale(5000, 800)).toBe(1.5); // capped
  });
});
