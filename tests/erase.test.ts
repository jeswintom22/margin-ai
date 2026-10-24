import { describe, it, expect } from "vitest";
import { PageHistory, EraseTransaction, removeStrokes } from "@/lib/history/history";
import { createPage, createStroke, userLayer } from "@/lib/document/types";

const mk = (pts: { x: number; y: number }[], width = 2) =>
  createStroke(pts, { color: "#000", width, tool: "pen" });

function pageWith(...strokes: ReturnType<typeof mk>[]) {
  const page = createPage("p");
  userLayer(page).strokes.push(...strokes);
  return page;
}

describe("EraseTransaction", () => {
  it("records a whole drag as one undoable op; undo/redo affects all strokes", () => {
    const a = mk([{ x: 0, y: 0 }, { x: 50, y: 0 }]);
    const b = mk([{ x: 0, y: 50 }, { x: 50, y: 50 }]);
    const c = mk([{ x: 0, y: 500 }, { x: 50, y: 500 }]); // far away
    const page = pageWith(a, b, c);
    const h = new PageHistory();

    // One drag: two eraseAt calls along the gesture path.
    const txn = new EraseTransaction(page.id);
    txn.eraseAt(page, 25, 0, 10);
    txn.eraseAt(page, 25, 50, 10);
    const op = txn.commit(page);
    expect(op).not.toBeNull();
    h.record(op!);

    expect(userLayer(page).strokes.map((s) => s.id)).toEqual([c.id]);
    expect(page.eraserOperations).toHaveLength(1);
    expect(h.canUndo).toBe(true);

    h.undo(page);
    expect(userLayer(page).strokes.map((s) => s.id)).toEqual([a.id, b.id, c.id]);
    expect(page.eraserOperations).toHaveLength(0);

    h.redo(page);
    expect(userLayer(page).strokes.map((s) => s.id)).toEqual([c.id]);
    expect(page.eraserOperations).toHaveLength(1);
  });

  it("does not record the same stroke twice within a gesture", () => {
    const a = mk([{ x: 0, y: 0 }, { x: 50, y: 0 }]);
    const page = pageWith(a);
    const txn = new EraseTransaction(page.id);
    expect(txn.eraseAt(page, 25, 0, 10)).toBe(1);
    expect(txn.eraseAt(page, 25, 0, 10)).toBe(0); // already removed
    const op = txn.commit(page);
    expect(op).not.toBeNull();
    expect(op!.type === "eraseStrokes" && op!.removed).toHaveLength(1);
  });

  it("committing an empty gesture returns null and mutates nothing", () => {
    const page = pageWith(mk([{ x: 0, y: 0 }]));
    const txn = new EraseTransaction(page.id);
    txn.eraseAt(page, 900, 900, 10); // misses
    expect(txn.commit(page)).toBeNull();
    expect(page.eraserOperations).toHaveLength(0);
    expect(userLayer(page).strokes).toHaveLength(1);
  });

  it("restores original order when several strokes in one layer are removed", () => {
    const a = mk([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    const b = mk([{ x: 0, y: 20 }, { x: 10, y: 20 }]);
    const c = mk([{ x: 0, y: 40 }, { x: 10, y: 40 }]);
    const d = mk([{ x: 0, y: 60 }, { x: 10, y: 60 }]);
    const page = pageWith(a, b, c, d);
    const h = new PageHistory();

    // Remove b and d (b's removal shifts d's live index from 3 to 2).
    const removed = removeStrokes(page, new Set([b.id, d.id]));
    const eraserOp = { id: "e1", targetStrokeIds: [b.id, d.id], at: 0 };
    page.eraserOperations.push(eraserOp);
    h.record({ type: "eraseStrokes", eraserOp, removed });

    h.undo(page);
    expect(userLayer(page).strokes.map((s) => s.id)).toEqual([a.id, b.id, c.id, d.id]);
  });
});
