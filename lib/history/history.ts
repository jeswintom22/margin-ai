import { newId, type Notebook, type NotebookPage, type PageElement, type Stroke, type EraserOperation } from "@/lib/document/types";
import { splitStrokeByCircle } from "@/lib/drawing/geometry";

/**
 * Operation-based undo/redo, scoped per page.
 *
 * Each operation stores everything needed to revert and re-apply it.
 * Applying an operation mutates the page in place; callers then persist.
 * A new edit clears the redo stack (standard linear-history semantics).
 */

/**
 * A stroke removed from a layer. `replacements` are the fragments that took its
 * place (partial erase); they occupy `index` onward in the layer after removal.
 */
export type RemovedStroke = { layerId: string; index: number; stroke: Stroke; replacements?: Stroke[] };

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
  | { type: "setLayerVisibility"; layerId: string; from: boolean; to: boolean }
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
  } else if (op.type === "setLayerVisibility") {
    layerOf(page, op.layerId).visible = op.to;
  } else if (op.type === "removeElements") {
    const layer = layerOf(page, op.layerId);
    const ids = new Set(op.removed.map((r) => r.element.id));
    layer.elements = layer.elements.filter((e) => !ids.has(e.id));
  } else if (op.type === "eraseStrokes") {
    // Replay removals in order, swapping in any fragments where the stroke was.
    for (const r of op.removed) {
      const layer = layerOf(page, r.layerId);
      const i = layer.strokes.findIndex((s) => s.id === r.stroke.id);
      if (i >= 0) layer.strokes.splice(i, 1, ...(r.replacements ?? []));
    }
    page.eraserOperations.push(op.eraserOp);
  }
}

/** Apply an insertElements op to the whole notebook (may create pages). */
export function applyInsertion(nb: Notebook, op: Extract<Operation, { type: "insertElements" }>) {
  for (const c of op.createdPages) {
    // A created page kept by a previous undo (it held user ink) is reused.
    if (!nb.pages.some((p) => p.id === c.page.id)) nb.pages.splice(Math.min(c.index, nb.pages.length), 0, c.page);
  }
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
  // Remove pages this insertion created — unless the user has since written on
  // them or added other content; never delete user ink, never leave zero pages.
  const created = new Set(op.createdPages.map((c) => c.page.id));
  const isEmpty = (p: NotebookPage) => p.layers.every((l) => l.strokes.length === 0 && l.elements.length === 0);
  const kept = nb.pages.filter((p) => !created.has(p.id) || !isEmpty(p));
  if (kept.length) nb.pages = kept;
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
      if (r.replacements?.length) {
        const ids = new Set(r.replacements.map((s) => s.id));
        layer.strokes = layer.strokes.filter((s) => !ids.has(s.id));
      }
      layer.strokes.splice(Math.min(r.index, layer.strokes.length), 0, r.stroke);
    }
    const i = page.eraserOperations.findIndex((e) => e.id === op.eraserOp.id);
    if (i >= 0) page.eraserOperations.splice(i, 1);
  }
  if (op.type === "setLayerVisibility") layerOf(page, op.layerId).visible = op.from;
  if (op.type === "removeElements") {
    // Indices are original positions; re-insert in ascending order so each
    // element lands back exactly where it was (works for non-contiguous sets).
    const layer = layerOf(page, op.layerId);
    for (const r of [...op.removed].sort((a, b) => a.index - b.index)) {
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
 * The eraser is a pixel-style eraser: only the part of a stroke under the
 * eraser circle is removed, and the remaining runs are kept as new fragment
 * strokes in the same layer position. Changes apply immediately for live
 * feedback, but history is recorded once, at commit, as an exact replayable
 * log. Committing an empty gesture returns null — no op, nothing to undo.
 */
export class EraseTransaction {
  private removed: RemovedStroke[] = [];
  /** Fragments created during this gesture (not pre-existing strokes). */
  private created = new Set<string>();
  /** Pre-existing strokes touched by this gesture, for provenance. */
  private targets: string[] = [];

  constructor(readonly pageId: string) {}

  get strokeCount() {
    return this.targets.length;
  }

  /** Erase the ink under the circle at (x, y). Returns how many strokes were cut. */
  eraseAt(page: NotebookPage, x: number, y: number, radius: number): number {
    if (page.id !== this.pageId) return 0;
    let changed = 0;
    for (const layer of page.layers) {
      // Backwards, so splicing fragments in never shifts indices still to visit.
      for (let i = layer.strokes.length - 1; i >= 0; i--) {
        const s = layer.strokes[i];
        const pieces = splitStrokeByCircle(s, x, y, radius);
        if (!pieces) continue;
        const replacements = pieces.map((points) => ({ ...s, id: newId(), points }));
        layer.strokes.splice(i, 1, ...replacements);
        this.removed.push({ layerId: layer.id, index: i, stroke: s, replacements });
        if (this.created.has(s.id)) this.created.delete(s.id);
        else this.targets.push(s.id);
        for (const f of replacements) this.created.add(f.id);
        changed++;
      }
    }
    return changed;
  }

  /**
   * End the gesture. Records the provenance entry on the page and returns the
   * single `eraseStrokes` op covering the whole gesture, or null if nothing
   * was removed.
   */
  commit(page: NotebookPage): Extract<Operation, { type: "eraseStrokes" }> | null {
    if (page.id !== this.pageId || this.removed.length === 0) return null;
    const eraserOp: EraserOperation = {
      id: newId(),
      targetStrokeIds: this.targets.slice(),
      at: Date.now(),
    };
    page.eraserOperations.push(eraserOp);
    return { type: "eraseStrokes", eraserOp, removed: this.removed.slice() };
  }
}

export type InsertOperation = Extract<Operation, { type: "insertElements" }>;
export type PageOperation = Exclude<Operation, InsertOperation>;

/**
 * One undo entry with an explicit, typed target: either a single page or the
 * whole notebook (AI insertions can create and modify several pages).
 */
export type HistoryEntry =
  | { scope: "page"; pageId: string; op: PageOperation }
  | { scope: "notebook"; op: InsertOperation };

function entryTouches(e: HistoryEntry, pageId: string): boolean {
  if (e.scope === "page") return e.pageId === pageId;
  return e.op.appends.some((a) => a.pageId === pageId) || e.op.createdPages.some((c) => c.page.id === pageId);
}

/** Page to show after undo/redo: the affected page that still exists. */
function focusOf(nb: Notebook, e: HistoryEntry): string | null {
  const ids = e.scope === "page" ? [e.pageId] : e.op.appends.map((a) => a.pageId);
  return ids.find((id) => nb.pages.some((p) => p.id === id)) ?? null;
}

/**
 * Notebook-wide linear history (LIFO across pages). Undo always reverses the
 * most recent edit anywhere, so an earlier operation is never undone while a
 * later edit still depends on it; the UI navigates to the affected page.
 */
export class NotebookHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  constructor(readonly limit = 300) {}

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  record(entry: HistoryEntry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Returns the page id to focus, or null if nothing was undone. */
  undo(nb: Notebook): string | null {
    const e = this.undoStack.pop();
    if (!e) return null;
    if (e.scope === "notebook") revertInsertion(nb, e.op);
    else {
      const page = nb.pages.find((p) => p.id === e.pageId);
      if (!page) return null; // pruned target; entry dropped
      revert(page, e.op);
    }
    this.redoStack.push(e);
    return focusOf(nb, e) ?? nb.pages[0]?.id ?? null;
  }

  redo(nb: Notebook): string | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    if (e.scope === "notebook") applyInsertion(nb, e.op);
    else {
      const page = nb.pages.find((p) => p.id === e.pageId);
      if (!page) return null;
      apply(page, e.op);
    }
    this.undoStack.push(e);
    return focusOf(nb, e);
  }

  /** Drop entries that reference a deleted page (page deletion isn't undoable). */
  prunePage(pageId: string) {
    this.undoStack = this.undoStack.filter((e) => !entryTouches(e, pageId));
    this.redoStack = this.redoStack.filter((e) => !entryTouches(e, pageId));
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}
