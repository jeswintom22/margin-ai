import { describe, it, expect } from "vitest";
import { createNotebook, createPage, clonePage, drawLayer, createLayer, templateOf } from "@/lib/xdoc/factories";
import { parseNotebook, NotebookFormatError } from "@/lib/xdoc/schema";
import { ptToPx, pxToPt, PAGE_SIZES } from "@/lib/xdoc/units";
import { isDarkColor } from "@/lib/xdoc/templates";
import type { Stroke } from "@/lib/xdoc/types";

const stroke = (id = "s1"): Stroke => ({
  id, type: "stroke", tool: "pen", color: "#000000", width: 1.5,
  points: [{ x: 1, y: 1 }, { x: 5, y: 5 }], widths: [1, 2],
});

describe("units", () => {
  it("round-trips pt <-> px at 96/72", () => {
    expect(ptToPx(72)).toBe(96);
    expect(pxToPt(96)).toBe(72);
    expect(PAGE_SIZES.A4.width).toBeCloseTo(595.28);
  });
});

describe("factories", () => {
  it("creates a valid A4 lined notebook with one user layer", () => {
    const nb = createNotebook("Math");
    expect(nb.pages).toHaveLength(1);
    expect(nb.pages[0].layers[0].author).toBe("user");
    expect(parseNotebook(JSON.parse(JSON.stringify(nb)))).toEqual(nb);
  });

  it("drawLayer never returns an AI layer and prefers the requested user layer", () => {
    const p = createPage();
    const ai = createLayer("AI", "ai");
    p.layers.push(ai);
    expect(drawLayer(p, ai.id).author).toBe("user");
    const second = createLayer("Layer 2");
    p.layers.push(second);
    expect(drawLayer(p, second.id)).toBe(second);
    expect(drawLayer(p).id).toBe(second.id); // topmost user layer
  });

  it("drawLayer creates a user layer when only AI layers exist", () => {
    const p = createPage();
    p.layers = [createLayer("AI", "ai")];
    const l = drawLayer(p);
    expect(l.author).toBe("user");
    expect(p.layers[0]).toBe(l);
  });

  it("clonePage gives fresh ids everywhere and keeps content", () => {
    const p = createPage();
    p.layers[0].elements.push(stroke());
    const c = clonePage(p);
    expect(c.id).not.toBe(p.id);
    expect(c.layers[0].id).not.toBe(p.layers[0].id);
    expect(c.layers[0].elements[0].id).not.toBe("s1");
    expect((c.layers[0].elements[0] as Stroke).points).toEqual(stroke().points);
  });

  it("templateOf copies size and solid background", () => {
    const p = createPage({ width: 612, height: 792, background: { kind: "solid", style: "graph", color: "#fffbe6" } });
    expect(templateOf(p)).toEqual({ width: 612, height: 792, background: { kind: "solid", style: "graph", color: "#fffbe6" } });
  });
});

describe("schema v4", () => {
  const valid = () => {
    const nb = createNotebook("T");
    nb.pages[0].layers[0].elements.push(stroke());
    return JSON.parse(JSON.stringify(nb));
  };

  it("accepts all element types", () => {
    const nb = valid();
    nb.pages[0].layers[0].elements.push(
      { id: "t", type: "text", x: 0, y: 0, text: "hi", font: "sans-serif", size: 12, color: "#112233" },
      { id: "i", type: "image", x: 0, y: 0, w: 10, h: 10, blobId: "b1" },
      { id: "x", type: "tex", x: 0, y: 0, w: 10, h: 10, latex: "x^2", svg: "<svg/>" }
    );
    expect(() => parseNotebook(nb)).not.toThrow();
  });

  it("rejects widths/points length mismatch", () => {
    const nb = valid();
    nb.pages[0].layers[0].elements[0].widths = [1];
    expect(() => parseNotebook(nb)).toThrow(NotebookFormatError);
  });

  it("rejects bad colors, empty pages and non-finite coordinates", () => {
    const a = valid();
    a.pages[0].layers[0].elements[0].color = "red";
    expect(() => parseNotebook(a)).toThrow(/color/);
    const b = valid();
    b.pages = [];
    expect(() => parseNotebook(b)).toThrow(NotebookFormatError);
    const c = valid();
    c.pages[0].layers[0].elements[0].points[0].x = null;
    expect(() => parseNotebook(c)).toThrow(NotebookFormatError);
  });

  it("rejects future versions with an update message", () => {
    const nb = valid();
    nb.schemaVersion = 99;
    expect(() => parseNotebook(nb)).toThrow(/newer version/);
  });

  it("accepts pdf and image backgrounds", () => {
    const nb = valid();
    nb.pages[0].background = { kind: "pdf", blobId: "p", pageNo: 3 };
    expect(() => parseNotebook(nb)).not.toThrow();
    nb.pages[0].background = { kind: "pdf", blobId: "p", pageNo: 0 };
    expect(() => parseNotebook(nb)).toThrow(NotebookFormatError);
  });
});

describe("templates", () => {
  it("detects dark paper", () => {
    expect(isDarkColor("#2b2b2b")).toBe(true);
    expect(isDarkColor("#ffffff")).toBe(false);
  });
});
