import type { NotebookPage, Stroke, EraserOperation } from "@/lib/document/types";

/**
 * Operation-based undo/redo, scoped per page.
 *
 * Each operation stores everything needed to revert and re-apply it.
 * Applying an operation mutates the page in place; callers then persist.
 * A new edit clears the redo stack (standard linear-history semantics).
 */

export type RemovedStroke = { layerId: string; index: number; stroke: Stroke };

export type Operation =
  | { type: "addStroke"; layerId: string; stroke: Stroke }
  | { type: "eraseStrokes"; eraserOp: EraserOperation; removed: RemovedStroke[] };

export class PageHistory {
  private undoStack: Operation[] = [];
  private redoStack: Operation[] = [];
  readonly limit: number;

  constructor(limit = 200) {
    this.limit = limit;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /** Record an operation that has already been applied to the page. */
  record(op: Operation) {
    this.undoStack.push(op);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(page: NotebookPage): boolean {
    const op = this.undoStack.pop();
    if (!op) return false;
    revert(page, op);
    this.redoStack.push(op);
    return true;
  }

  redo(page: NotebookPage): boolean {
    const op = this.redoStack.pop();
    if (!op) return false;
    apply(page, op);
    this.undoStack.push(op);
    return true;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}

function layerOf(page: NotebookPage, layerId: string) {
  const l = page.layers.find((x) => x.id === layerId);
  if (!l) throw new Error(`layer ${layerId} not found`);
  return l;
}

export function apply(page: NotebookPage, op: Operation) {
  if (op.type === "addStroke") {
    layerOf(page, op.layerId).strokes.push(op.stroke);
  } else {
    // Remove strokes by id (order-independent), then record the eraser op.
    const ids = new Set(op.removed.map((r) => r.stroke.id));
    for (const layer of page.layers) {
      layer.strokes = layer.strokes.filter((s) => !ids.has(s.id));
    }
    page.eraserOperations.push(op.eraserOp);
  }
}

export function revert(page: NotebookPage, op: Operation) {
  if (op.type === "addStroke") {
    const layer = layerOf(page, op.layerId);
    const i = layer.strokes.findIndex((s) => s.id === op.stroke.id);
    if (i >= 0) layer.strokes.splice(i, 1);
  } else {
    // Restore each stroke at its original index.
    for (const r of op.removed) {
      const layer = layerOf(page, r.layerId);
      layer.strokes.splice(Math.min(r.index, layer.strokes.length), 0, r.stroke);
    }
    const i = page.eraserOperations.findIndex((e) => e.id === op.eraserOp.id);
    if (i >= 0) page.eraserOperations.splice(i, 1);
  }
}
