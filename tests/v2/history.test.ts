import { describe, it, expect } from "vitest";
import { createNotebook, createPage } from "@/lib/xdoc/factories";
import type { Element, Notebook, Stroke } from "@/lib/xdoc/types";
import {
  HistoryStack, InsertElements, RemoveElements, SetLayerElements, InsertPages, DeletePage, MovePage,
  SetPageProps, Composite, HISTORY_LIMIT,
} from "@/lib/engine/history";

const s = (id: string): Stroke => ({ id, type: "stroke", tool: "pen", color: "#000000", width: 1, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
const snap = (nb: Notebook) => JSON.parse(JSON.stringify(nb));
const layer = (nb: Notebook, p = 0) => nb.pages[p].layers[0];

function setup() {
  const nb = createNotebook("T");
  nb.pages.push(createPage(), createPage());
  return { nb, h: new HistoryStack() };
}

describe("element commands", () => {
  it("insert/remove restore exact order", () => {
    const { nb, h } = setup();
    const L = layer(nb);
    h.run(nb, new InsertElements([0, 1, 2].map((i) => ({ pageId: nb.pages[0].id, layerId: L.id, index: i, element: s(`s${i}`) }))));
    const before = snap(nb);
    h.run(nb, new RemoveElements([{ pageId: nb.pages[0].id, layerId: L.id, index: 1, element: L.elements[1] }]));
    expect(L.elements.map((e) => e.id)).toEqual(["s0", "s2"]);
    h.undo(nb);
    expect(snap(nb)).toEqual(before);
    h.redo(nb);
    expect(L.elements.map((e) => e.id)).toEqual(["s0", "s2"]);
  });

  it("SetLayerElements swaps whole arrays without sharing", () => {
    const { nb, h } = setup();
    const L = layer(nb);
    const before: Element[] = [s("a"), s("b")];
    L.elements = [...before];
    const after: Element[] = [s("a1"), s("a2"), before[1]];
    h.run(nb, new SetLayerElements([{ pageId: nb.pages[0].id, layerId: L.id, before, after }]));
    expect(L.elements.map((e) => e.id)).toEqual(["a1", "a2", "b"]);
    L.elements.push(s("stray")); // mutating the live array must not corrupt the command
    h.undo(nb);
    expect(L.elements.map((e) => e.id)).toEqual(["a", "b"]);
    h.redo(nb);
    expect(L.elements.map((e) => e.id)).toEqual(["a1", "a2", "b"]);
  });
});

describe("page commands", () => {
  it("delete page is undoable and restores position + content", () => {
    const { nb, h } = setup();
    layer(nb, 1).elements.push(s("keep"));
    const before = snap(nb);
    h.run(nb, new DeletePage(nb.pages[1].id));
    expect(nb.pages).toHaveLength(2);
    expect(h.undo(nb)).toEqual([before.pages[1].id]);
    expect(snap(nb)).toEqual(before);
  });

  it("insert and move pages", () => {
    const { nb, h } = setup();
    const ids = nb.pages.map((p) => p.id);
    const np = createPage();
    h.run(nb, new InsertPages(1, [np]));
    expect(nb.pages[1].id).toBe(np.id);
    h.run(nb, new MovePage(np.id, 1, 3));
    expect(nb.pages.map((p) => p.id)).toEqual([ids[0], ids[1], ids[2], np.id]);
    h.undo(nb);
    h.undo(nb);
    expect(nb.pages.map((p) => p.id)).toEqual(ids);
  });

  it("page props change and revert", () => {
    const { nb, h } = setup();
    const p = nb.pages[0];
    const before = { width: p.width, height: p.height, background: { ...p.background } };
    const after = { width: 612, height: 792, background: { kind: "solid" as const, style: "graph" as const, color: "#fffbe6" } };
    h.run(nb, new SetPageProps([{ pageId: p.id, before, after }]));
    expect(p.background).toEqual(after.background);
    h.undo(nb);
    expect(p.width).toBe(before.width);
    expect(p.background).toEqual(before.background);
  });
});

describe("stack", () => {
  it("composite reverts in reverse order", () => {
    const { nb, h } = setup();
    const np = createPage();
    const before = snap(nb);
    // insert a page then draw on it — revert must remove the stroke before the page
    h.run(nb, new Composite([new InsertPages(3, [np]), new InsertElements([{ pageId: np.id, layerId: np.layers[0].id, index: 0, element: s("x") }])]));
    h.undo(nb);
    expect(snap(nb)).toEqual(before);
  });

  it("random op sequences undo back to the original document", () => {
    const { nb, h } = setup();
    const original = snap(nb);
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 16807) % 2147483647) % n);
    for (let i = 0; i < 200; i++) {
      const p = nb.pages[rnd(nb.pages.length)];
      const L = p.layers[0];
      const op = rnd(5);
      if (op === 0 || L.elements.length === 0) h.run(nb, new InsertElements([{ pageId: p.id, layerId: L.id, index: rnd(L.elements.length + 1), element: s(`e${i}`) }]));
      else if (op === 1) { const k = rnd(L.elements.length); h.run(nb, new RemoveElements([{ pageId: p.id, layerId: L.id, index: k, element: L.elements[k] }])); }
      else if (op === 2) h.run(nb, new InsertPages(rnd(nb.pages.length + 1), [createPage()]));
      else if (op === 3 && nb.pages.length > 1) h.run(nb, new DeletePage(p.id));
      else if (nb.pages.length > 1) { const a = nb.pages.indexOf(p), b = rnd(nb.pages.length); h.run(nb, new MovePage(p.id, a, b)); }
    }
    while (h.canUndo) h.undo(nb);
    expect(snap(nb)).toEqual(original);
  });

  it("redo is cleared by a new command and history is capped", () => {
    const { nb, h } = setup();
    const L = layer(nb);
    h.run(nb, new InsertElements([{ pageId: nb.pages[0].id, layerId: L.id, index: 0, element: s("a") }]));
    h.undo(nb);
    expect(h.canRedo).toBe(true);
    h.run(nb, new InsertElements([{ pageId: nb.pages[0].id, layerId: L.id, index: 0, element: s("b") }]));
    expect(h.canRedo).toBe(false);
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) h.run(nb, new InsertElements([{ pageId: nb.pages[0].id, layerId: L.id, index: 0, element: s(`c${i}`) }]));
    let n = 0;
    while (h.undo(nb)) n++;
    expect(n).toBe(HISTORY_LIMIT);
  });
});
