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

    const ids = () => userLayer(page).strokes.map((s) => s.id);
    // a and b are each split into a left and right fragment; c is untouched.
    const afterErase = ids();
    expect(afterErase).toHaveLength(5);
    expect(afterErase).not.toContain(a.id);
    expect(afterErase).not.toContain(b.id);
    expect(afterErase[4]).toBe(c.id);
    expect(page.eraserOperations).toHaveLength(1);
    expect(page.eraserOperations[0].targetStrokeIds.sort()).toEqual([a.id, b.id].sort());
    expect(h.canUndo).toBe(true);

    h.undo(page);
    expect(ids()).toEqual([a.id, b.id, c.id]);
    expect(page.eraserOperations).toHaveLength(0);

    h.redo(page);
    expect(ids()).toEqual(afterErase);
    expect(page.eraserOperations).toHaveLength(1);
  });

  it("erases only the part of a stroke under the eraser", () => {
    const a = mk([{ x: 0, y: 0 }, { x: 100, y: 0 }], 2);
    const page = pageWith(a);
    const txn = new EraseTransaction(page.id);
    expect(txn.eraseAt(page, 50, 0, 10)).toBe(1);
    const [left, right] = userLayer(page).strokes;
    // Cut at radius + width/2 = 11 on either side of x=50.
    expect(left.points.map((p) => p.x)).toEqual([0, 39]);
    expect(right.points.map((p) => p.x)).toEqual([61, 100]);
    expect(left.color).toBe(a.color);
    expect(left.width).toBe(a.width);
  });

  it("removes a stroke entirely when the eraser covers all of it", () => {
    const page = pageWith(mk([{ x: 0, y: 0 }, { x: 4, y: 0 }]));
    const txn = new EraseTransaction(page.id);
    expect(txn.eraseAt(page, 2, 0, 10)).toBe(1);
    expect(userLayer(page).strokes).toHaveLength(0);
  });

  it("re-erasing a fragment in the same gesture undoes back to the original", () => {
    const a = mk([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    const page = pageWith(a);
    const h = new PageHistory();
    const txn = new EraseTransaction(page.id);
    expect(txn.eraseAt(page, 50, 0, 10)).toBe(1);
    expect(txn.eraseAt(page, 50, 0, 10)).toBe(0); // nothing left under the eraser
    expect(txn.eraseAt(page, 80, 0, 10)).toBe(1); // cuts the right fragment
    expect(userLayer(page).strokes).toHaveLength(3);
    const op = txn.commit(page)!;
    expect(op.eraserOp.targetStrokeIds).toEqual([a.id]);
    h.record(op);
    h.undo(page);
    expect(userLayer(page).strokes.map((s) => s.id)).toEqual([a.id]);
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
