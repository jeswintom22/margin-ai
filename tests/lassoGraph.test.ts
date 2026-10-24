import { describe, it, expect, vi } from "vitest";
import { pointInPolygon, strokeInLasso, polygonBounds } from "@/lib/drawing/geometry";
import { CanvasGesture, closeLasso, LASSO_CLOSE_DIST, type GestureEvents } from "@/lib/drawing/gesture";
import { sampleExpression, sampleCurves, autoYRange, niceTicks, MAX_SAMPLES } from "@/lib/math/graph";
import { toUnicodeMath } from "@/lib/math/unicodeMath";
import { layoutAnswer, placeNearSelection, measureText, LAYOUT } from "@/lib/ai/answerLayout";
import { answerDocumentSchema, type AnswerDocument } from "@/lib/ai/answerSchema";
import { createStroke, PAGE_WIDTH } from "@/lib/document/types";

const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const stroke = (pts: [number, number][]) =>
  createStroke(pts.map(([x, y]) => ({ x, y })), { color: "#000", width: 2, tool: "pen" });

describe("lasso geometry", () => {
  it("point-in-polygon", () => {
    expect(pointInPolygon(50, 50, square)).toBe(true);
    expect(pointInPolygon(150, 50, square)).toBe(false);
    // concave "C" shape: the notch is outside
    const c = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 70 }, { x: 100, y: 70 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    expect(pointInPolygon(60, 50, c)).toBe(false);
    expect(pointInPolygon(15, 50, c)).toBe(true);
  });

  it("selects strokes inside or crossing the loop, not outside", () => {
    expect(strokeInLasso(stroke([[10, 10], [20, 20]]), square)).toBe(true);
    expect(strokeInLasso(stroke([[90, 50], [150, 50]]), square)).toBe(true);
    expect(strokeInLasso(stroke([[150, 150], [160, 160]]), square)).toBe(false);
    expect(strokeInLasso(stroke([[10, 10]]), square.slice(0, 2))).toBe(false);
    expect(polygonBounds(square)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});

describe("lasso gesture", () => {
  const make = () => {
    const ev = { onStrokeCommit: vi.fn(), onEraseBegin: vi.fn(), onEraseAt: vi.fn(), onEraseEnd: vi.fn(), onSelectCommit: vi.fn(), onLassoCommit: vi.fn() } satisfies GestureEvents;
    return { ev, g: new CanvasGesture(ev) };
  };
  const loop = (g: CanvasGesture) => {
    g.begin("lasso", 1, { x: 0, y: 0 }, 0);
    g.move(1, [{ x: 100, y: 0, stamp: 1 }, { x: 100, y: 100, stamp: 2 }, { x: 0, y: 100, stamp: 3 }, { x: 5, y: 5, stamp: 4 }]);
  };

  it("commits a closed loop once on pointer-up; lost capture after up is a no-op", () => {
    const { ev, g } = make();
    loop(g);
    g.end(1, "up");
    g.end(1, "lostCapture");
    expect(ev.onLassoCommit).toHaveBeenCalledTimes(1);
    const poly = ev.onLassoCommit.mock.calls[0][0];
    expect(poly.at(-1)).toEqual(poly[0]); // auto-closed
    expect(ev.onStrokeCommit).not.toHaveBeenCalled();
  });

  it("cancel discards the lasso; next gesture works", () => {
    const { ev, g } = make();
    loop(g);
    g.end(1, "cancel");
    expect(ev.onLassoCommit).not.toHaveBeenCalled();
    loop(g);
    g.end(1, "lostCapture");
    expect(ev.onLassoCommit).toHaveBeenCalledTimes(1);
  });

  it("leaves an open loop open (closed implicitly by the polygon test)", () => {
    const open = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 200 }];
    expect(closeLasso(open)).toEqual(open);
    expect(LASSO_CLOSE_DIST).toBeGreaterThan(0);
  });
});

describe("graph sampling", () => {
  it("samples a polynomial deterministically and caps the sample count", () => {
    const a = sampleExpression("6x^2", [-3, 3]);
    expect(a).toHaveLength(1);
    expect(a[0][0]).toEqual([-3, 54]);
    expect(sampleExpression("6x^2", [-3, 3])).toEqual(a);
    expect(sampleExpression("x", [0, 1], 10_000)[0].length).toBe(MAX_SAMPLES + 1);
  });

  it("splits at discontinuities and survives NaN/Infinity", () => {
    const segs = sampleExpression("1/x", [-1, 1], 200);
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs.flat().every(([, y]) => Number.isFinite(y))).toBe(true);
    expect(sampleExpression("sqrt(x)", [-4, 4]).flat().every(([x]) => x >= 0)).toBe(true);
    expect(sampleExpression("log(x-x)", [-1, 1])).toEqual([]);
  });

  it("rejects unsafe or invalid expressions without throwing out of sampleCurves", () => {
    const { curves, errors } = sampleCurves([{ expr: "x^2" }, { expr: "import(1)" }, { expr: "a.b" }, { expr: "x".repeat(300) }], [-1, 1]);
    expect(curves).toHaveLength(1);
    expect(errors).toHaveLength(3);
  });

  it("schema bounds graph ranges and expression counts", () => {
    const g = (extra: object) => ({ schemaVersion: 1, title: "g", blocks: [{ id: "b1", type: "graph", expressions: [{ expr: "x" }], xRange: [-1, 1], ...extra }] });
    expect(answerDocumentSchema.safeParse(g({})).success).toBe(true);
    expect(answerDocumentSchema.safeParse(g({ xRange: [1, -1] })).success).toBe(false);
    expect(answerDocumentSchema.safeParse(g({ xRange: [-1e6, 1e6] })).success).toBe(false);
    expect(answerDocumentSchema.safeParse(g({ expressions: Array(5).fill({ expr: "x" }) })).success).toBe(false);
    expect(answerDocumentSchema.safeParse(g({ points: [[0, 0]] })).success).toBe(true); // extra keys are stripped
  });

  it("auto y-range and ticks", () => {
    expect(autoYRange([[[[0, 0], [1, 10]]]], [0, 5])).toEqual([0, 5]);
    const [lo, hi] = autoYRange([sampleExpression("x^2", [-2, 2])]);
    expect(lo).toBeLessThan(0.5);
    expect(hi).toBeGreaterThan(3.5);
    expect(niceTicks(-3, 3)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
  });

  it("lays out a graph as AI elements within the page", () => {
    const doc = answerDocumentSchema.parse({ schemaVersion: 1, title: "Graph", blocks: [{ id: "b1", type: "graph", expressions: [{ expr: "6x^2", label: "g(x)" }], xRange: [-3, 3] }] }) as AnswerDocument;
    const els = layoutAnswer(doc).pages[0].filter((e) => e.blockId === "b1");
    expect(els.filter((e) => e.type === "line").length).toBeGreaterThan(20); // axes + ticks + curve
    expect(els.some((e) => e.type === "text" && e.text.includes("g(x)"))).toBe(true);
    expect(els.every((e) => e.type !== "line" || Math.max(e.x1, e.x2) <= PAGE_WIDTH)).toBe(true);
  });
});

describe("unicode math for handwriting text", () => {
  it.each([
    ["x^2", "x²"],
    ["\\frac{a}{b}", "a/b"],
    ["\\frac{x+1}{2}", "(x+1)/2"],
    ["\\int_0^1 x\\,dx", "∫₀¹ x dx"],
    ["\\sqrt{x}", "√x"],
    ["sqrt(x+1)", "√(x+1)"],
    ["g'(x) = 12x", "g'(x) = 12x"],
    ["x^{10}", "x¹⁰"],
    ["e^{i\\pi}", "e^(iπ)"],
  ])("%s → %s", (src, out) => {
    expect(toUnicodeMath(src)).toBe(out);
  });
});

describe("placement beside the selection", () => {
  const doc = answerDocumentSchema.parse({ schemaVersion: 1, title: "Hint", blocks: [{ id: "b1", type: "paragraph", text: "Use the power rule." }] }) as AnswerDocument;

  it("places below the selection when there is room", () => {
    const r = placeNearSelection(doc, { minX: 100, minY: 100, maxX: 300, maxY: 160 });
    expect(r.placement).toBe("below");
    const ys = r.pages[0].filter((e) => e.type === "text").map((e) => (e.type === "text" ? e.y : 0));
    expect(Math.min(...ys)).toBeGreaterThan(160);
    expect(r.pages[0].every((e) => e.type !== "text" || e.x >= 100)).toBe(true);
  });

  it("falls back to the right, then to the normal flow", () => {
    const right = placeNearSelection(doc, { minX: 60, minY: 200, maxX: 300, maxY: 1060 });
    expect(right.placement).toBe("right");
    expect(right.pages[0].every((e) => e.type !== "text" || e.x >= 320)).toBe(true);
    const flow = placeNearSelection(doc, { minX: 60, minY: 200, maxX: 700, maxY: 1060 });
    expect(flow.placement).toBe("flow");
  });

  it("keeps text inside the region's width", () => {
    const long = answerDocumentSchema.parse({ schemaVersion: 1, title: "T", blocks: [{ id: "b1", type: "paragraph", text: "word ".repeat(80) }] }) as AnswerDocument;
    const r = placeNearSelection(long, { minX: 400, minY: 100, maxX: 500, maxY: 150 });
    for (const e of r.pages[0]) if (e.type === "text") expect(e.x + measureText(e.text, e.size)).toBeLessThanOrEqual(PAGE_WIDTH - LAYOUT.marginX + 2);
  });
});
