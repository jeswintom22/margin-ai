import { describe, it, expect } from "vitest";
import {
  createNotebook, createPage, createStroke, createLayer, userLayer, aiLayer,
  type Notebook, type PageElement,
} from "@/lib/document/types";
import { NotebookHistory, EraseTransaction, applyInsertion, type InsertOperation } from "@/lib/history/history";

const stroke = (x: number) =>
  createStroke([{ x, y: x }, { x: x + 10, y: x }], { color: "#000", width: 2, tool: "pen" });

const text = (id: string): PageElement => ({
  id, groupId: "g", blockId: "b", type: "text", x: 1, y: 1, text: id, font: "hand", size: 10,
});

/** Insert a 2-page answer: elements on page 0 + one newly created page. */
function insertTwoPage(nb: Notebook, h: NotebookHistory): InsertOperation {
  const start = nb.pages[0];
  const created = createPage("P-ai");
  const ai2 = createLayer("AI", "ai");
  created.layers.push(ai2);
  const op: InsertOperation = {
    type: "insertElements", groupId: "g",
    createdPages: [{ page: created, index: 1 }],
    appends: [
      { pageId: start.id, layerId: aiLayer(start).id, elements: [text("e1")] },
      { pageId: created.id, layerId: ai2.id, elements: [text("e2")] },
    ],
  };
  applyInsertion(nb, op);
  h.record({ scope: "notebook", op });
  return op;
}

const aiCount = (nb: Notebook) =>
  nb.pages.reduce((n, p) => n + p.layers.reduce((m, l) => m + l.elements.length, 0), 0);

describe("NotebookHistory", () => {
  it("undoes and redoes an erase on a non-first page on that page", () => {
    const nb = createNotebook("n");
    nb.pages.push(createPage("P2"));
    const p2 = nb.pages[1];
    const s = stroke(100);
    userLayer(p2).strokes.push(s);
    const h = new NotebookHistory();
    const tx = new EraseTransaction(p2.id);
    expect(tx.eraseAt(p2, 105, 100, 4)).toBe(1);
    h.record({ scope: "page", pageId: p2.id, op: tx.commit(p2)! });

    expect(h.undo(nb)).toBe(p2.id);
    expect(userLayer(p2).strokes.map((x) => x.id)).toEqual([s.id]);
    expect(userLayer(nb.pages[0]).strokes).toHaveLength(0);
    expect(h.redo(nb)).toBe(p2.id);
    expect(userLayer(p2).strokes).toHaveLength(0);
  });

  it("undoes a multi-page insertion regardless of the current page and redoes without duplication", () => {
    const nb = createNotebook("n");
    const h = new NotebookHistory();
    insertTwoPage(nb, h);
    expect(nb.pages).toHaveLength(2);
    expect(aiCount(nb)).toBe(2);

    // History is notebook-wide; the current page plays no role in targeting.
    expect(h.undo(nb)).toBe(nb.pages[0].id);
    expect(nb.pages).toHaveLength(1);
    expect(aiCount(nb)).toBe(0);

    h.redo(nb);
    expect(nb.pages).toHaveLength(2);
    expect(aiCount(nb)).toBe(2);
    h.undo(nb);
    h.redo(nb);
    expect(nb.pages).toHaveLength(2);
    expect(aiCount(nb)).toBe(2);
  });

  it("undoes later edits first, so an insertion never discards subsequent user ink", () => {
    const nb = createNotebook("n");
    const h = new NotebookHistory();
    insertTwoPage(nb, h);
    const p2 = nb.pages[1];
    const s = stroke(20);
    const layer = userLayer(p2);
    layer.strokes.push(s);
    h.record({ scope: "page", pageId: p2.id, op: { type: "addStroke", layerId: layer.id, stroke: s } });

    // First undo reverses the stroke (the most recent edit), not the insertion.
    expect(h.undo(nb)).toBe(p2.id);
    expect(layer.strokes).toHaveLength(0);
    expect(aiCount(nb)).toBe(2);
    h.undo(nb);
    expect(aiCount(nb)).toBe(0);
    // Redo both back in order.
    h.redo(nb);
    h.redo(nb);
    expect(nb.pages[1].id).toBe(p2.id);
    expect(layer.strokes).toHaveLength(1);
  });

  it("retains a created page that holds unrecorded user content, and never leaves zero pages", () => {
    const nb = createNotebook("n");
    const h = new NotebookHistory();
    const op = insertTwoPage(nb, h);
    userLayer(nb.pages[1]).strokes.push(stroke(1)); // e.g. content from a non-history path
    h.undo(nb);
    expect(nb.pages).toHaveLength(2);
    expect(userLayer(nb.pages[1]).strokes).toHaveLength(1);
    expect(aiCount(nb)).toBe(0);
    h.redo(nb);
    expect(nb.pages).toHaveLength(2);
    expect(op.appends.every((a) => nb.pages.some((p) => p.id === a.pageId))).toBe(true);
    expect(aiCount(nb)).toBe(2);
  });

  it("makes AI-layer visibility undoable without touching content", () => {
    const nb = createNotebook("n");
    const h = new NotebookHistory();
    insertTwoPage(nb, h);
    const page = nb.pages[0];
    const ai = aiLayer(page);
    ai.visible = false;
    h.record({ scope: "page", pageId: page.id, op: { type: "setLayerVisibility", layerId: ai.id, from: true, to: false } });
    h.undo(nb);
    expect(ai.visible).toBe(true);
    expect(ai.elements).toHaveLength(1);
    h.redo(nb);
    expect(ai.visible).toBe(false);
  });

  it("prunes entries for a deleted page", () => {
    const nb = createNotebook("n");
    nb.pages.push(createPage("P2"));
    const p2 = nb.pages[1];
    const layer = userLayer(p2);
    const s = stroke(5);
    layer.strokes.push(s);
    const h = new NotebookHistory();
    h.record({ scope: "page", pageId: p2.id, op: { type: "addStroke", layerId: layer.id, stroke: s } });
    nb.pages.pop();
    h.prunePage(p2.id);
    expect(h.canUndo).toBe(false);
  });
});
