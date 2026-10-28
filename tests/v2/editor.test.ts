import { describe, expect, it, vi } from "vitest";
import { Editor } from "@/lib/engine/Editor";
import { createLayer, createNotebook } from "@/lib/xdoc/factories";
import type { Stroke } from "@/lib/xdoc/types";

const snap = (e: Editor) => JSON.parse(JSON.stringify(e.doc));
const elements = (e: Editor, p = 0, l = 0) => e.doc.pages[p].layers[l].elements;

function draw(e: Editor, tool: "pen" | "highlighter" | "eraser", pts: [number, number, number?][], pageIndex = 0) {
  const id = e.doc.pages[pageIndex].id;
  const [first, ...rest] = pts;
  e.beginGesture(tool, id, { x: first[0], y: first[1], pressure: first[2] });
  e.moveGesture(rest.map(([x, y, p]) => ({ x, y, pressure: p })));
  e.endGesture();
}

const hline = (y: number, x0 = 50, x1 = 250): [number, number][] => Array.from({ length: 21 }, (_, i) => [x0 + ((x1 - x0) * i) / 20, y]);

describe("Editor drawing", () => {
  it("pen stroke is one undo step; redo restores it", () => {
    const e = new Editor(createNotebook("T"));
    const dirty = vi.fn();
    e.setDirtyHandler(dirty);
    draw(e, "pen", hline(100));
    expect(elements(e)).toHaveLength(1);
    expect(dirty).toHaveBeenCalled();
    e.undo();
    expect(elements(e)).toHaveLength(0);
    e.redo();
    expect((elements(e)[0] as Stroke).tool).toBe("pen");
  });

  it("pressure produces per-point widths; mouse does not", () => {
    const e = new Editor(createNotebook("T"));
    draw(e, "pen", hline(100).map(([x, y], i) => [x, y, i / 20] as [number, number, number]));
    draw(e, "pen", hline(200));
    const [a, b] = elements(e) as Stroke[];
    expect(a.widths?.length).toBe(a.points.length);
    expect(b.widths).toBeUndefined();
  });

  it("highlighter uses its own width and never pressure", () => {
    const e = new Editor(createNotebook("T"));
    draw(e, "highlighter", hline(100).map(([x, y]) => [x, y, 0.9] as [number, number, number]));
    const s = elements(e)[0] as Stroke;
    expect(s.tool).toBe("highlighter");
    expect(s.widths).toBeUndefined();
    expect(s.width).toBeGreaterThan(e.toolSettings.penWidth);
  });

  it("line style is stored on pen strokes", () => {
    const e = new Editor(createNotebook("T"));
    e.updateSettings({ lineStyle: "dash" });
    draw(e, "pen", hline(100));
    expect((elements(e)[0] as Stroke).lineStyle).toBe("dash");
  });

  it("never draws into an AI layer", () => {
    const nb = createNotebook("T");
    const ai = createLayer("AI", "ai");
    nb.pages[0].layers.push(ai);
    const e = new Editor(nb);
    e.setCurrentLayer(nb.pages[0].id, ai.id);
    draw(e, "pen", hline(100));
    expect(ai.elements).toHaveLength(0);
    expect(elements(e)).toHaveLength(1);
  });

  it("canceled pen gesture adds nothing", () => {
    const e = new Editor(createNotebook("T"));
    e.beginGesture("pen", e.doc.pages[0].id, { x: 10, y: 10 });
    e.moveGesture([{ x: 50, y: 50 }]);
    e.endGesture(true);
    expect(elements(e)).toHaveLength(0);
    expect(e.ui.canUndo).toBe(false);
  });
});

describe("Editor erasers", () => {
  it("standard eraser splits a stroke; undo restores it exactly", () => {
    const e = new Editor(createNotebook("T"));
    draw(e, "pen", hline(100));
    const before = snap(e);
    draw(e, "eraser", [[150, 80], [150, 100], [150, 120]]);
    expect(elements(e)).toHaveLength(2);
    e.undo();
    expect(snap(e).pages).toEqual(before.pages);
  });

  it("delete-stroke eraser removes whole strokes it touches, not neighbors", () => {
    const e = new Editor(createNotebook("T"));
    draw(e, "pen", hline(100));
    draw(e, "pen", hline(160));
    e.updateSettings({ eraserMode: "stroke" });
    draw(e, "eraser", [[150, 95], [150, 105]]);
    expect(elements(e)).toHaveLength(1);
    expect((elements(e)[0] as Stroke).points[0].y).toBe(160);
  });

  it("whiteout draws a background-colored stroke instead of deleting", () => {
    const e = new Editor(createNotebook("T"));
    draw(e, "pen", hline(100));
    e.updateSettings({ eraserMode: "whiteout" });
    draw(e, "eraser", [[150, 80], [150, 120]]);
    const strokes = elements(e) as Stroke[];
    expect(strokes).toHaveLength(2);
    expect(strokes[1].tool).toBe("whiteout");
  });

  it("erasing across a fast drag interpolates so thin strokes aren't skipped", () => {
    const e = new Editor(createNotebook("T"));
    draw(e, "pen", hline(100, 140, 160).map(([x]) => [150, 60 + (x - 140) * 4] as [number, number])); // vertical stroke at x=150
    e.updateSettings({ eraserMode: "stroke" });
    draw(e, "eraser", [[50, 100], [300, 100]]); // single jump across it
    expect(elements(e)).toHaveLength(0);
  });
});

describe("Editor pages", () => {
  it("insert after/before, duplicate, move and delete are all undoable", () => {
    const e = new Editor(createNotebook("T"));
    const original = snap(e);
    const p2 = e.insertPage();
    expect(e.ui.currentPageId).toBe(p2);
    e.insertPage(p2, "before");
    draw(e, "pen", hline(100), 2);
    const dup = e.duplicatePage(e.doc.pages[2].id)!;
    expect(e.doc.pages[3].id).toBe(dup);
    expect(elements(e, 3)).toHaveLength(1);
    e.movePage(dup, 0);
    expect(e.doc.pages[0].id).toBe(dup);
    expect(e.deletePage(dup)).toBe(true);
    while (e.ui.canUndo) e.undo();
    expect(snap(e).pages).toEqual(original.pages);
  });

  it("cannot delete the last page", () => {
    const e = new Editor(createNotebook("T"));
    expect(e.deletePage()).toBe(false);
  });

  it("undo focuses the page it changed", () => {
    const e = new Editor(createNotebook("T"));
    e.insertPage();
    draw(e, "pen", hline(100), 0);
    e.setCurrentPage(e.doc.pages[1].id);
    e.undo();
    expect(e.ui.pageIndex).toBe(0);
  });

  it("page template applies to several pages as one step", () => {
    const e = new Editor(createNotebook("T"));
    e.insertPage();
    const ids = e.doc.pages.map((p) => p.id);
    e.setPageTemplate(ids, { width: 612, height: 792, background: { kind: "solid", style: "dotted", color: "#fffbe6" } });
    expect(e.doc.pages.every((p) => p.width === 612 && p.background.kind === "solid" && p.background.style === "dotted")).toBe(true);
    e.undo();
    expect(e.doc.pages.every((p) => p.width !== 612)).toBe(true);
  });

  it("emits UI snapshots with undo labels", () => {
    const e = new Editor(createNotebook("T"));
    const seen: number[] = [];
    e.subscribe(() => seen.push(e.ui.rev));
    draw(e, "pen", hline(100));
    expect(seen.length).toBeGreaterThan(0);
    expect(e.ui.undoLabel).toBe("Draw");
  });

  it("load replaces the document and clears history", () => {
    const e = new Editor(createNotebook("A"));
    draw(e, "pen", hline(100));
    e.load(createNotebook("B"));
    expect(e.ui.title).toBe("B");
    expect(e.ui.canUndo).toBe(false);
  });
});
