import { describe, it, expect } from "vitest";
import { clientToPage, fitScale } from "@/lib/drawing/coords";

describe("clientToPage", () => {
  const rect = { left: 100, top: 50, width: 1000, height: 800 };
  const pageW = 800, pageH = 1000;

  it("maps the canvas center to the page center", () => {
    const scale = fitScale(rect.width, rect.height, pageW, pageH);
    const p = clientToPage(600, 450, rect, pageW, pageH, scale); // center of 1000x800 at (100,50)
    expect(p.x).toBeCloseTo(pageW / 2);
    expect(p.y).toBeCloseTo(pageH / 2);
  });

  it("is stable across resize (document-space coords)", () => {
    // Same page point must map back regardless of container size.
    const small = { left: 0, top: 0, width: 400, height: 300 };
    const s1 = fitScale(rect.width, rect.height, pageW, pageH);
    const s2 = fitScale(small.width, small.height, pageW, pageH);
    // page point (400, 500) in each container
    const c1 = {
      x: 600, // center
      y: 450,
    };
    const p1 = clientToPage(c1.x, c1.y, rect, pageW, pageH, s1);
    const c2 = {
      x: small.left + small.width / 2,
      y: small.top + small.height / 2,
    };
    const p2 = clientToPage(c2.x, c2.y, small, pageW, pageH, s2);
    expect(p1.x).toBeCloseTo(p2.x);
    expect(p1.y).toBeCloseTo(p2.y);
  });

  it("accounts for canvas offset position", () => {
    const scale = 1;
    const p = clientToPage(rect.left + rect.width / 2, rect.top + rect.height / 2, rect, 1000, 800, scale);
    expect(p.x).toBeCloseTo(500);
    expect(p.y).toBeCloseTo(400);
  });
});
