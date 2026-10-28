import type { Notebook, Page, PageTemplate } from "@/lib/xdoc/types";
import { clonePage, createPage, templateOf } from "@/lib/xdoc/factories";
import { HistoryStack, InsertPages, DeletePage, MovePage, SetPageProps, type Command, type PageProps } from "./history";
import { DEFAULT_TOOL_SETTINGS, startGesture, type Gesture, type LivePreview, type Sample, type ToolSettings } from "./tools";
import { DEFAULT_INPUT, type InputSettings, type ToolId } from "./input";
import type { LayoutMode } from "./layout";

export type ZoomMode = "fitWidth" | "fitPage" | "custom";

/** Immutable UI snapshot for React (rebuilt on every change). */
export type EditorUI = {
  rev: number;
  title: string;
  pageCount: number;
  pageIndex: number;
  currentPageId: string;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  tool: ToolId;
  settings: ToolSettings;
  input: Omit<InputSettings, "tool">;
  layout: LayoutMode;
  zoomMode: ZoomMode;
  /** Zoom relative to 100% (only meaningful when zoomMode === "custom"; the workspace reports the effective value). */
  zoom: number;
};

type Listener = () => void;
type PageListener = (pageIds: ReadonlySet<string>) => void;

/**
 * Framework-agnostic editor core. Owns the document and its history; every
 * mutation goes through `run(command)`. React reads `ui` via
 * useSyncExternalStore; page canvases subscribe to page invalidations so
 * inking never re-renders React.
 */
export class Editor {
  readonly history = new HistoryStack();
  private listeners = new Set<Listener>();
  private pageListeners = new Set<PageListener>();
  private gesture: Gesture | null = null;
  private rev = 0;
  private _ui: EditorUI;
  private tool: ToolId = "pen";
  private settings: ToolSettings = { ...DEFAULT_TOOL_SETTINGS };
  private input: Omit<InputSettings, "tool"> = { ...DEFAULT_INPUT };
  private layout: LayoutMode = "vertical";
  private zoomMode: ZoomMode = "fitWidth";
  private zoom = 1;
  private currentPageId: string;
  /** Current (draw) layer per page. */
  private currentLayer = new Map<string, string>();
  /** Called after every document change (autosave hook). */
  private onDirty: (() => void) | null = null;
  /** Zoom actually on screen (fit modes compute it); reported by the workspace. */
  private effectiveZoom = 1;

  setDirtyHandler(fn: (() => void) | null) {
    this.onDirty = fn;
  }

  /** Workspace reports the on-screen zoom (no event: it doesn't change the UI snapshot). */
  reportZoom(zoom: number) {
    this.effectiveZoom = zoom;
  }

  /** Zoom by a factor relative to what is on screen (switches to custom zoom). */
  zoomBy(factor: number) {
    this.setZoom("custom", Math.min(8, Math.max(0.1, this.effectiveZoom * factor)));
  }

  constructor(public doc: Notebook) {
    this.currentPageId = doc.pages[0].id;
    this._ui = this.snapshot();
  }

  // ---------- subscriptions ----------

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  get ui(): EditorUI {
    return this._ui;
  }

  getUI = () => this._ui;

  subscribePages(fn: PageListener) {
    this.pageListeners.add(fn);
    return () => this.pageListeners.delete(fn);
  }

  private snapshot(): EditorUI {
    const idx = Math.max(0, this.doc.pages.findIndex((p) => p.id === this.currentPageId));
    return {
      rev: this.rev,
      title: this.doc.title,
      pageCount: this.doc.pages.length,
      pageIndex: idx,
      currentPageId: this.doc.pages[idx].id,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      undoLabel: this.history.undoLabel,
      redoLabel: this.history.redoLabel,
      tool: this.tool,
      settings: this.settings,
      input: this.input,
      layout: this.layout,
      zoomMode: this.zoomMode,
      zoom: this.zoom,
    };
  }

  private emit() {
    this.rev++;
    this._ui = this.snapshot();
    for (const f of this.listeners) f();
  }

  invalidate(pageIds: Iterable<string>) {
    const set = new Set(pageIds);
    if (set.size) for (const f of this.pageListeners) f(set);
  }

  private changed(pages: Iterable<string>) {
    this.doc.updatedAt = Date.now();
    this.invalidate(pages);
    this.emit();
    this.onDirty?.();
  }

  // ---------- document ----------

  page(id: string): Page | undefined {
    return this.doc.pages.find((p) => p.id === id);
  }

  get currentPage(): Page {
    return this.page(this.currentPageId) ?? this.doc.pages[0];
  }

  /** Replace the whole document (open/import). Clears history. */
  load(doc: Notebook) {
    this.cancelGesture();
    this.doc = doc;
    this.history.clear();
    this.currentLayer.clear();
    this.currentPageId = doc.pages[0].id;
    this.invalidate(doc.pages.map((p) => p.id));
    this.emit();
  }

  /** Apply + record a command. */
  run(cmd: Command) {
    this.history.run(this.doc, cmd);
    this.changed(cmd.pages());
  }

  /** Record a command whose effect is already applied (live gestures). */
  record(cmd: Command) {
    this.history.push(cmd);
    this.changed(cmd.pages());
  }

  undo(): string | null {
    this.cancelGesture();
    const pages = this.history.undo(this.doc);
    if (!pages) return null;
    return this.afterHistory(pages);
  }

  redo(): string | null {
    this.cancelGesture();
    const pages = this.history.redo(this.doc);
    if (!pages) return null;
    return this.afterHistory(pages);
  }

  private afterHistory(pages: string[]): string | null {
    const focus = pages.find((id) => this.page(id)) ?? null;
    if (focus) this.currentPageId = focus;
    else if (!this.page(this.currentPageId)) this.currentPageId = this.doc.pages[0].id;
    this.changed(pages);
    return focus;
  }

  rename(title: string) {
    const t = title.trim().slice(0, 200);
    if (!t || t === this.doc.title) return;
    this.doc.title = t;
    this.changed([]);
  }

  // ---------- pages ----------

  setCurrentPage(id: string) {
    if (id === this.currentPageId || !this.page(id)) return;
    this.currentPageId = id;
    this.emit();
  }

  /** Insert a new page after (or before) a page, using its template. Returns the new id. */
  insertPage(relativeTo: string = this.currentPageId, where: "after" | "before" = "after", template?: PageTemplate): string {
    const i = this.doc.pages.findIndex((p) => p.id === relativeTo);
    const ref = this.doc.pages[Math.max(0, i)];
    const page = createPage(template ?? templateOf(ref));
    this.run(new InsertPages(where === "after" ? i + 1 : Math.max(0, i), [page]));
    this.currentPageId = page.id;
    this.emit();
    return page.id;
  }

  duplicatePage(id: string = this.currentPageId): string | null {
    const i = this.doc.pages.findIndex((p) => p.id === id);
    if (i < 0) return null;
    const copy = clonePage(this.doc.pages[i]);
    this.run(new InsertPages(i + 1, [copy], "Duplicate page"));
    this.currentPageId = copy.id;
    this.emit();
    return copy.id;
  }

  /** Undoable. The last page can't be deleted. */
  deletePage(id: string = this.currentPageId): boolean {
    if (this.doc.pages.length <= 1) return false;
    const i = this.doc.pages.findIndex((p) => p.id === id);
    if (i < 0) return false;
    this.run(new DeletePage(id));
    if (this.currentPageId === id) this.currentPageId = this.doc.pages[Math.max(0, i - 1)].id;
    this.emit();
    return true;
  }

  movePage(id: string, to: number): boolean {
    const from = this.doc.pages.findIndex((p) => p.id === id);
    const dest = Math.max(0, Math.min(this.doc.pages.length - 1, to));
    if (from < 0 || from === dest) return false;
    this.run(new MovePage(id, from, dest));
    return true;
  }

  /** Change size/background of pages (one undo step). */
  setPageTemplate(pageIds: string[], template: PageTemplate) {
    const changes = pageIds
      .map((id) => this.page(id))
      .filter((p): p is Page => !!p)
      .map((p) => {
        const before: PageProps = { width: p.width, height: p.height, background: { ...p.background } };
        // Keep PDF/image backgrounds when only the size changes is not meaningful: a template replaces them.
        const after: PageProps = { width: template.width, height: template.height, background: { ...template.background } };
        return { pageId: p.id, before, after };
      });
    if (changes.length) this.run(new SetPageProps(changes));
  }

  // ---------- layers ----------

  currentLayerId(pageId: string): string | null {
    return this.currentLayer.get(pageId) ?? null;
  }

  setCurrentLayer(pageId: string, layerId: string) {
    this.currentLayer.set(pageId, layerId);
    this.emit();
  }

  // ---------- tools & settings ----------

  setTool(tool: ToolId) {
    if (tool === this.tool) return;
    this.cancelGesture();
    this.tool = tool;
    this.emit();
  }

  get currentTool() {
    return this.tool;
  }

  updateSettings(patch: Partial<ToolSettings>) {
    this.settings = { ...this.settings, ...patch };
    this.emit();
  }

  get toolSettings() {
    return this.settings;
  }

  updateInput(patch: Partial<Omit<InputSettings, "tool">>) {
    this.input = { ...this.input, ...patch };
    this.emit();
  }

  get inputSettings(): InputSettings {
    return { tool: this.tool, ...this.input };
  }

  setLayoutMode(mode: LayoutMode) {
    if (mode === this.layout) return;
    this.layout = mode;
    this.emit();
  }

  setZoom(mode: ZoomMode, zoom = this.zoom) {
    this.zoomMode = mode;
    this.zoom = zoom;
    this.emit();
  }

  // ---------- gestures ----------

  /** Begin a drawing gesture on a page. Returns false if the tool doesn't draw. */
  beginGesture(tool: ToolId, pageId: string, s: Sample): boolean {
    if (tool !== "pen" && tool !== "highlighter" && tool !== "eraser") return false;
    const page = this.page(pageId);
    if (!page) return false;
    this.cancelGesture();
    this.gesture = startGesture(page, tool, this.settings, this.currentLayerId(pageId), s);
    this.invalidate(this.gesture.dirtyPages());
    return true;
  }

  moveGesture(samples: Sample[]) {
    const g = this.gesture;
    if (!g) return;
    g.move(samples);
    this.invalidate(g.dirtyPages());
  }

  endGesture(canceled = false) {
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    const { command, applied } = g.end(canceled);
    if (command) {
      if (applied) this.record(command);
      else this.run(command);
    } else this.invalidate([g.pageId]);
  }

  cancelGesture() {
    if (this.gesture) this.endGesture(true);
  }

  get livePreview(): { pageId: string; preview: LivePreview } | null {
    return this.gesture ? { pageId: this.gesture.pageId, preview: this.gesture.preview() } : null;
  }
}
