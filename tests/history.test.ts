import { describe, it, expect } from "vitest";
import { PageHistory, apply } from "@/lib/history/history";
import {
  createPage,
  createStroke,
  userLayer,
  aiLayer,
  newId,
} from "@/lib/document/types";

const s = (x: number) =>
  createStroke(
    [
      { x, y: 0 },
      { x: x + 10, y: 10 },
    ],
    { color: "#000", width: 2, tool: "pen" }
  );

function addStrokeOp(page: ReturnType<typeof createPage>, stroke = s(0)) {
  const layer = userLayer(page);
  return { type: "addStroke" as const, layerId: layer.id, stroke };
}

describe("PageHistory", () => {
  it("undoes an added stroke", () => {
    const page = createPage("p");
    const h = new PageHistory();
    const op = addStrokeOp(page);
    apply(page, op);
    h.record(op);
    expect(userLayer(page).strokes).toHaveLength(1);

    expect(h.undo(page)).toBe(true);
    expect(userLayer(page).strokes).toHaveLength(0);
    expect(h.canRedo).toBe(true);

    expect(h.redo(page)).toBe(true);
    expect(userLayer(page).strokes).toHaveLength(1);
  });

  it("restores erased strokes at their original index", () => {
    const page = createPage("p");
    const h = new PageHistory();
    const layer = userLayer(page);
    const a = s(0), b = s(20), c = s(40);
    for (const st of [a, b, c]) {
      const op = addStrokeOp(page, st);
      apply(page, op);
      h.record(op);
    }

    const erase = {
      type: "eraseStrokes" as const,
      eraserOp: { id: newId(), targetStrokeIds: [b.id], at: Date.now() },
      removed: [{ layerId: layer.id, index: 1, stroke: b }],
    };
    apply(page, erase);
    h.record(erase);
    expect(layer.strokes.map((x) => x.id)).toEqual([a.id, c.id]);
    expect(page.eraserOperations).toHaveLength(1);

    h.undo(page);
    expect(layer.strokes.map((x) => x.id)).toEqual([a.id, b.id, c.id]);
    expect(page.eraserOperations).toHaveLength(0);
  });

  it("clears redo stack on new edits", () => {
    const page = createPage("p");
    const h = new PageHistory();
    const op1 = addStrokeOp(page, s(0));
    apply(page, op1);
    h.record(op1);
    h.undo(page);
    expect(h.canRedo).toBe(true);
    const op2 = addStrokeOp(page, s(50));
    apply(page, op2);
    h.record(op2);
    expect(h.canRedo).toBe(false);
  });

  it("does not cross between user and ai layers", () => {
    const page = createPage("p");
    const ai = aiLayer(page);
    const aiStroke = createStroke([{ x: 0, y: 0 }, { x: 5, y: 5 }], {
      color: "#00f", width: 2, tool: "pen", author: "ai",
    });
    apply(page, { type: "addStroke", layerId: ai.id, stroke: aiStroke });

    const h = new PageHistory();
    h.record({ type: "addStroke", layerId: ai.id, stroke: aiStroke });
    h.undo(page);
    expect(ai.strokes).toHaveLength(0);
    expect(userLayer(page).strokes).toHaveLength(0);
  });
});
