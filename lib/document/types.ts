/**
 * Document model for the notebook.
 *
 * Design notes:
 * - All stroke coordinates are stored in *page space* (document units, 1 unit = 1 CSS px
 *   at 100% zoom). Pages have a fixed intrinsic size, so strokes survive canvas
 *   resizing, DPR changes, and zoom.
 * - Content is organized into layers. User and AI content live in separate layers and
 *   are never merged; AI layers can be hidden/edited/deleted independently.
 * - `eraserOperations` is a provenance log. Erasing physically removes strokes from a
 *   layer but records which stroke ids were removed; undo restores the strokes from
 *   history and removes the log entry.
 * - `schemaVersion` enables migrations for future fields (text objects, images, math).
 */

export const SCHEMA_VERSION = 3;

/** Intrinsic page size in document units (A4 at 96dpi, rounded). */
export const PAGE_WIDTH = 794;
export const PAGE_HEIGHT = 1123;

export type Point = {
  x: number;
  y: number;
  /** 0..1, present for pressure-capable pointers. */
  pressure?: number;
  /** ms timestamp relative to stroke start. */
  time?: number;
};

export type StrokeTool = "pen" | "highlighter";

export type Stroke = {
  id: string;
  points: Point[];
  color: string;
  /** Base width in document units; pressure modulates rendered width. */
  width: number;
  tool: StrokeTool;
  author: "user" | "ai";
};

export type EraserOperation = {
  id: string;
  targetStrokeIds: string[];
  at: number;
};

export type LayerAuthor = "user" | "ai";

/**
 * Typed, positioned AI-authored content — the renderable output of laying out
 * an AnswerDocument. Semantic text stays text (not fake pen strokes) so it can
 * be re-rendered, edited, or removed cleanly. Every element carries the
 * insertion `groupId` and its source `blockId` for provenance.
 */
export type ElementFont = "hand" | "mono";

type ElementBase = {
  id: string;
  /** Insertion operation this element belongs to. */
  groupId: string;
  /** Id of the AnswerDocument block this element was laid out from. */
  blockId: string;
};

export type PageElement =
  | (ElementBase & {
      type: "text";
      x: number;
      y: number;
      text: string;
      font: ElementFont;
      size: number;
      bold?: boolean;
      color?: string;
    })
  | (ElementBase & {
      type: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      width?: number;
      color?: string;
    })
  | (ElementBase & {
      type: "rect";
      x: number;
      y: number;
      w: number;
      h: number;
      fill?: string;
      stroke?: string;
    });

export type NotebookLayer = {
  id: string;
  name: string;
  author: LayerAuthor;
  visible: boolean;
  strokes: Stroke[];
  /** Positioned AI-authored elements; always empty on user layers today. */
  elements: PageElement[];
};

export type PaperStyle = "blank" | "ruled" | "grid";

export type NotebookPage = {
  id: string;
  title: string;
  /** Intrinsic page size in document units. */
  width: number;
  height: number;
  paperStyle: PaperStyle;
  /** Rendered bottom-to-top. Layer 0 is always the user layer. */
  layers: NotebookLayer[];
  eraserOperations: EraserOperation[];
  /** Locked image drawn under every layer (e.g. an imported PDF page). Never edited by tools. */
  background?: PageBackground;
};

/** Raster page background (JPEG/PNG data URL) at its rendered pixel size. */
export type PageBackground = { dataUrl: string; width: number; height: number; label?: string };

export type Notebook = {
  id: string;
  title: string;
  pages: NotebookPage[];
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
};

export type NotebookMeta = {
  id: string;
  title: string;
  pageCount: number;
  updatedAt: number;
};

export type EditorTool = "pen" | "highlighter" | "eraser" | "select" | "lasso";

let counter = 0;
/** Stable unique id: timestamp + counter + random suffix. */
export function newId(): string {
  counter = (counter + 1) % 0xffff;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function createStroke(
  points: Point[],
  opts: { color: string; width: number; tool: StrokeTool; author?: "user" | "ai" }
): Stroke {
  return {
    id: newId(),
    points,
    color: opts.color,
    width: opts.width,
    tool: opts.tool,
    author: opts.author ?? "user",
  };
}

export function createLayer(name: string, author: LayerAuthor): NotebookLayer {
  return { id: newId(), name, author, visible: true, strokes: [], elements: [] };
}

export function createPage(title: string, paperStyle: PaperStyle = "ruled"): NotebookPage {
  return {
    id: newId(),
    title,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    paperStyle,
    layers: [createLayer("Notes", "user")],
    eraserOperations: [],
  };
}

export function createNotebook(title: string): Notebook {
  const now = Date.now();
  return {
    id: newId(),
    title,
    pages: [createPage("Page 1")],
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
  };
}

/** The user-authored layer of a page (always exists; created on demand if missing). */
export function userLayer(page: NotebookPage): NotebookLayer {
  let l = page.layers.find((x) => x.author === "user");
  if (!l) {
    l = createLayer("Notes", "user");
    page.layers.unshift(l);
  }
  return l;
}

/** Get or create the AI layer of a page (AI-readiness hook). */
export function aiLayer(page: NotebookPage): NotebookLayer {
  let l = page.layers.find((x) => x.author === "ai");
  if (!l) {
    l = createLayer("AI", "ai");
    page.layers.push(l);
  }
  return l;
}
