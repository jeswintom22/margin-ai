/**
 * Margin notebook document model v4 — modeled on Xournal++'s .xopp so that
 * import/export and PDF export map nearly 1:1.
 *
 * - Coordinates are PDF points (see units.ts).
 * - A page owns a background and a bottom-to-top stack of layers.
 * - Layers carry an `author`: AI content lives only in "ai" layers and tools
 *   never draw into them. Shapes are strokes (as in Xournal++).
 * - Binary payloads (PDFs, images, audio) live in the blob store and are
 *   referenced by `blobId`; the document itself stays small JSON.
 */

export const SCHEMA_VERSION = 4;

export type Point = { x: number; y: number };

export type LineStyle = "plain" | "dash" | "dashdot" | "dot";

export type StrokeTool = "pen" | "highlighter" | "whiteout";

/** Audio link (P7): the recording and the ms offset when the element was made. */
export type AudioLink = { audioId: string; ts: number };

type ElementBase = {
  id: string;
  /** AI provenance: insertion group and source answer block. */
  groupId?: string;
  blockId?: string;
};

export type Stroke = ElementBase & {
  type: "stroke";
  tool: StrokeTool;
  /** CSS hex: #rrggbb or #rrggbbaa. */
  color: string;
  /** Nominal width in points. */
  width: number;
  /** Optional per-point widths (pressure); same length as points. */
  widths?: number[];
  points: Point[];
  lineStyle?: LineStyle;
  /** Fill color for closed shapes. */
  fill?: string;
  audio?: AudioLink;
};

export type TextEl = ElementBase & {
  type: "text";
  x: number;
  y: number;
  text: string;
  /** CSS font family, or "margin-hand" for the learned AI handwriting. */
  font: string;
  size: number;
  color: string;
  audio?: AudioLink;
};

export type ImageEl = ElementBase & {
  type: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  blobId: string;
};

export type TexEl = ElementBase & {
  type: "tex";
  x: number;
  y: number;
  w: number;
  h: number;
  latex: string;
  svg: string;
};

export type Element = Stroke | TextEl | ImageEl | TexEl;
export type ElementType = Element["type"];

export type LayerAuthor = "user" | "ai";

export type Layer = {
  id: string;
  name: string;
  visible: boolean;
  author: LayerAuthor;
  elements: Element[];
};

export type BackgroundStyle =
  | "plain"
  | "lined"
  | "ruled"
  | "graph"
  | "dotted"
  | "isoDotted"
  | "isoGraph"
  | "staves";

export type Background =
  | { kind: "solid"; style: BackgroundStyle; color: string }
  | { kind: "pdf"; blobId: string; pageNo: number }
  | { kind: "image"; blobId: string };

export type Page = {
  id: string;
  width: number;
  height: number;
  background: Background;
  layers: Layer[];
};

export type Notebook = {
  id: string;
  title: string;
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
  pages: Page[];
};

export type NotebookMeta = { id: string; title: string; pageCount: number; updatedAt: number };

export type PageTemplate = {
  width: number;
  height: number;
  background: Extract<Background, { kind: "solid" }>;
};
