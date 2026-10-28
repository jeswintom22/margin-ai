import type { Element, Layer, Notebook, Page } from "@/lib/xdoc/types";

/**
 * Command-pattern undo/redo over the notebook. Every document mutation is a
 * Command that is applied once and pushed; undo/redo replay it. Elements are
 * treated as immutable values (edits replace them), so commands can hold
 * references instead of deep copies.
 *
 * One notebook-wide stack: undo always reverses the most recent edit anywhere
 * (LIFO), so every page/layer a command refers to still exists when it is
 * reverted — including page deletions, which are themselves commands.
 */
export interface Command {
  readonly label: string;
  apply(doc: Notebook): void;
  revert(doc: Notebook): void;
  /** Pages touched (first one is focused after undo/redo). */
  pages(): string[];
}

export class HistoryError extends Error {}

export function findPage(doc: Notebook, pageId: string): Page {
  const p = doc.pages.find((x) => x.id === pageId);
  if (!p) throw new HistoryError(`page ${pageId} not found`);
  return p;
}

export function findLayer(doc: Notebook, pageId: string, layerId: string): Layer {
  const l = findPage(doc, pageId).layers.find((x) => x.id === layerId);
  if (!l) throw new HistoryError(`layer ${layerId} not found`);
  return l;
}

export type ElementEntry = { pageId: string; layerId: string; index: number; element: Element };

/** Insert elements at given indices (ascending order per layer). */
export class InsertElements implements Command {
  readonly label: string;
  constructor(readonly entries: ElementEntry[], label = "Insert") {
    this.label = label;
  }
  apply(doc: Notebook) {
    for (const e of [...this.entries].sort((a, b) => a.index - b.index)) {
      const l = findLayer(doc, e.pageId, e.layerId);
      l.elements.splice(Math.min(e.index, l.elements.length), 0, e.element);
    }
  }
  revert(doc: Notebook) {
    for (const e of this.entries) {
      const l = findLayer(doc, e.pageId, e.layerId);
      const i = l.elements.findIndex((x) => x.id === e.element.id);
      if (i >= 0) l.elements.splice(i, 1);
    }
  }
  pages() {
    return [...new Set(this.entries.map((e) => e.pageId))];
  }
}

/** Remove elements; `index` records where each was so undo restores order. */
export class RemoveElements implements Command {
  private readonly inverse: InsertElements;
  readonly label: string;
  constructor(entries: ElementEntry[], label = "Delete") {
    this.inverse = new InsertElements(entries, label);
    this.label = label;
  }
  apply(doc: Notebook) {
    this.inverse.revert(doc);
  }
  revert(doc: Notebook) {
    this.inverse.apply(doc);
  }
  pages() {
    return this.inverse.pages();
  }
}

/**
 * Replace a layer's whole element list (before → after). Used by gestures that
 * rewrite many elements at once (eraser splits, transforms, recolor). Arrays
 * are shallow: elements are immutable, so this is cheap.
 */
export class SetLayerElements implements Command {
  constructor(
    readonly changes: { pageId: string; layerId: string; before: Element[]; after: Element[] }[],
    readonly label = "Edit"
  ) {}
  apply(doc: Notebook) {
    for (const c of this.changes) findLayer(doc, c.pageId, c.layerId).elements = [...c.after];
  }
  revert(doc: Notebook) {
    for (const c of this.changes) findLayer(doc, c.pageId, c.layerId).elements = [...c.before];
  }
  pages() {
    return [...new Set(this.changes.map((c) => c.pageId))];
  }
}

/** Insert whole pages at an index. */
export class InsertPages implements Command {
  constructor(readonly at: number, readonly inserted: Page[], readonly label = "Insert page") {}
  apply(doc: Notebook) {
    doc.pages.splice(Math.min(this.at, doc.pages.length), 0, ...this.inserted);
  }
  revert(doc: Notebook) {
    const ids = new Set(this.inserted.map((p) => p.id));
    doc.pages = doc.pages.filter((p) => !ids.has(p.id));
  }
  pages() {
    return this.inserted.map((p) => p.id);
  }
}

/** Delete one page (the notebook always keeps at least one: enforced by callers). */
export class DeletePage implements Command {
  readonly label = "Delete page";
  private index = -1;
  private page: Page | null = null;
  constructor(readonly pageId: string) {}
  apply(doc: Notebook) {
    this.index = doc.pages.findIndex((p) => p.id === this.pageId);
    if (this.index < 0) throw new HistoryError(`page ${this.pageId} not found`);
    this.page = doc.pages.splice(this.index, 1)[0];
  }
  revert(doc: Notebook) {
    if (!this.page) return;
    doc.pages.splice(this.index, 0, this.page);
  }
  pages() {
    return [this.pageId];
  }
}

export class MovePage implements Command {
  readonly label = "Move page";
  constructor(readonly pageId: string, readonly from: number, readonly to: number) {}
  private move(doc: Notebook, a: number, b: number) {
    const [p] = doc.pages.splice(a, 1);
    doc.pages.splice(b, 0, p);
  }
  apply(doc: Notebook) {
    this.move(doc, this.from, this.to);
  }
  revert(doc: Notebook) {
    this.move(doc, this.to, this.from);
  }
  pages() {
    return [this.pageId];
  }
}

export type PageProps = Pick<Page, "width" | "height" | "background">;

/** Change size/background of one or more pages. */
export class SetPageProps implements Command {
  constructor(readonly changes: { pageId: string; before: PageProps; after: PageProps }[], readonly label = "Page setup") {}
  private set(doc: Notebook, which: "before" | "after") {
    for (const c of this.changes) {
      const p = findPage(doc, c.pageId);
      const v = c[which];
      p.width = v.width;
      p.height = v.height;
      p.background = { ...v.background };
    }
  }
  apply(doc: Notebook) {
    this.set(doc, "after");
  }
  revert(doc: Notebook) {
    this.set(doc, "before");
  }
  pages() {
    return this.changes.map((c) => c.pageId);
  }
}

/** Several commands as one undo step (reverted in reverse order). */
export class Composite implements Command {
  constructor(readonly parts: Command[], readonly label = parts[0]?.label ?? "Edit") {}
  apply(doc: Notebook) {
    for (const c of this.parts) c.apply(doc);
  }
  revert(doc: Notebook) {
    for (let i = this.parts.length - 1; i >= 0; i--) this.parts[i].revert(doc);
  }
  pages() {
    return [...new Set(this.parts.flatMap((c) => c.pages()))];
  }
}

export const HISTORY_LIMIT = 500;

export class HistoryStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  /** Record a command that has already been applied. */
  push(cmd: Command) {
    this.undoStack.push(cmd);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Apply and record. */
  run(doc: Notebook, cmd: Command) {
    cmd.apply(doc);
    this.push(cmd);
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get undoLabel() {
    return this.undoStack.at(-1)?.label ?? null;
  }
  get redoLabel() {
    return this.redoStack.at(-1)?.label ?? null;
  }

  /** Returns the pages the undone command touched, or null if nothing to undo. */
  undo(doc: Notebook): string[] | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    cmd.revert(doc);
    this.redoStack.push(cmd);
    return cmd.pages();
  }

  redo(doc: Notebook): string[] | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    cmd.apply(doc);
    this.undoStack.push(cmd);
    return cmd.pages();
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}
