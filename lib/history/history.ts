import { newId, type Notebook, type NotebookPage, type PageElement, type Stroke, type EraserOperation } from "@/lib/document/types";
import { strokeHitsPoint } from "@/lib/drawing/geometry";

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
  | { type: "eraseStrokes"; eraserOp: EraserOperation; removed: RemovedStroke[] }
  | {
      type: "insertElements";
      groupId: string;
      /** Newly created pages, removed again on undo. */
      createdPages: { page: NotebookPage; index: number }[];
      /** Elements appended to existing pages. */
      appends: { pageId: string; layerId: string; elements: PageElement[] }[];
    }
  | {
      type: "removeElements";
      pageId: string;
      layerId: string;
      removed: { index: number; element: PageElement }[];
    };

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

  /** Undo a notebook-level op (insertElements spans pages). */
  undoNotebook(nb: Notebook): boolean {
    const op = this.undoStack.pop();
    if (!op) return false;
    if (op.type === "insertElements") revertInsertion(nb, op);
    else revert(nb.pages.find((p) => p.layers.some((l) => "layerId" in op && l.id === op.layerId)) ?? nb.pages[0], op);
    this.redoStack.push(op);
    return true;
  }

  redoNotebook(nb: Notebook): boolean {
    const op = this.redoStack.pop();
    if (!op) return false;
    if (op.type === "insertElements") applyInsertion(nb, op);
    else apply(nb.pages.find((p) => p.layers.some((l) => "layerId" in op && l.id === op.layerId)) ?? nb.pages[0], op);
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
  } else if (op.type === "removeElements") {
    const layer = layerOf(page, op.layerId);
    const ids = new Set(op.removed.map((r) => r.element.id));
    layer.elements = layer.elements.filter((e) => !ids.has(e.id));
  } else if (op.type === "eraseStrokes") {
    // Remove strokes by id (order-independent), then record the eraser op.
    const ids = new Set(op.removed.map((r) => r.stroke.id));
    for (const layer of page.layers) {
      layer.strokes = layer.strokes.filter((s) => !ids.has(s.id));
    }
    page.eraserOperations.push(op.eraserOp);
  }
}

/** Apply an insertElements op to the whole notebook (may create pages). */
export function applyInsertion(nb: Notebook, op: Extract<Operation, { type: "insertElements" }>) {
  for (const c of op.createdPages) nb.pages.splice(Math.min(c.index, nb.pages.length), 0, c.page);
  for (const a of op.appends) {
    const p = nb.pages.find((x) => x.id === a.pageId);
    const layer = p && layerOf(p, a.layerId);
    layer?.elements.push(...a.elements);
  }
}

export function revertInsertion(nb: Notebook, op: Extract<Operation, { type: "insertElements" }>) {
  const ids = new Set(op.appends.flatMap((a) => a.elements.map((e) => e.id)));
  for (const p of nb.pages) {
    for (const l of p.layers) l.elements = l.elements.filter((e) => !ids.has(e.id));
  }
  const created = new Set(op.createdPages.map((c) => c.page.id));
  nb.pages = nb.pages.filter((p) => !created.has(p.id));
}

export function revert(page: NotebookPage, op: Operation) {
  if (op.type === "addStroke") {
    const layer = layerOf(page, op.layerId);
    const i = layer.strokes.findIndex((s) => s.id === op.stroke.id);
    if (i >= 0) layer.strokes.splice(i, 1);
  } else if (op.type === "eraseStrokes") {
    // Each recorded index is the stroke's position just before its own removal,
    // so re-inserting in reverse removal order restores the original order.
    for (let i = op.removed.length - 1; i >= 0; i--) {
      const r = op.removed[i];
      const layer = layerOf(page, r.layerId);
      layer.strokes.splice(Math.min(r.index, layer.strokes.length), 0, r.stroke);
    }
    const i = page.eraserOperations.findIndex((e) => e.id === op.eraserOp.id);
    if (i >= 0) page.eraserOperations.splice(i, 1);
  }
  if (op.type === "removeElements") {
    const layer = layerOf(page, op.layerId);
    for (let i = op.removed.length - 1; i >= 0; i--) {
      const r = op.removed[i];
      layer.elements.splice(Math.min(r.index, layer.elements.length), 0, r.element);
    }
  }
}

/**
 * Remove the strokes with the given ids, one at a time. Each entry's `index` is
 * the stroke's position in its layer just before its own removal, which is what
 * `revert` relies on when restoring in reverse removal order.
 */
export function removeStrokes(page: NotebookPage, ids: ReadonlySet<string>): RemovedStroke[] {
  const removed: RemovedStroke[] = [];
  for (const layer of page.layers) {
    // Iterate backwards so a removal never shifts the positions we still need
    // to inspect, then reverse so `removed` is in document order.
    for (let i = layer.strokes.length - 1; i >= 0; i--) {
      const s = layer.strokes[i];
      if (ids.has(s.id)) {
        layer.strokes.splice(i, 1);
        removed.push({ layerId: layer.id, index: i, stroke: s });
      }
    }
  }
  removed.reverse();
  return removed;
}

/**
 * Transaction for one continuous eraser gesture (pointerdown → moves → end).
 * Strokes are removed immediately for live visual feedback, but history is only
 * recorded once, at commit. A stroke already removed in this gesture is never
 * recorded twice, and committing an empty gesture returns null — no op, no
 * eraserOperations entry, nothing to undo.
 */
export class EraseTransaction {
  private removed: RemovedStroke[] = [];
  private ids = new Set<string>();

  constructor(readonly pageId: string) {}

  get strokeCount() {
    return this.removed.length;
  }

  /** Remove newly-hit strokes near (x, y). Returns how many were removed. */
  eraseAt(page: NotebookPage, x: number, y: number, radius: number): number {
    if (page.id !== this.pageId) return 0;
    const hits = new Set<string>();
    for (const layer of page.layers) {
      for (const s of layer.strokes) {
        if (!this.ids.has(s.id) && strokeHitsPoint(s, x, y, radius)) hits.add(s.id);
      }
    }
    if (!hits.size) return 0;
    for (const r of removeStrokes(page, hits)) {
      this.ids.add(r.stroke.id);
      this.removed.push(r);
    }
    return hits.size;
  }

  /**
   * End the gesture. Records the provenance entry on the page and returns the
   * single `eraseStrokes` op covering the whole gesture, or null if nothing
   * was removed.
   */
  commit(page: NotebookPage): Operation | null {
    if (page.id !== this.pageId || this.removed.length === 0) return null;
    const eraserOp: EraserOperation = {
      id: newId(),
      targetStrokeIds: this.removed.map((r) => r.stroke.id),
      at: Date.now(),
    };
    page.eraserOperations.push(eraserOp);
    return { type: "eraseStrokes", eraserOp, removed: this.removed.slice() };
  }
}
