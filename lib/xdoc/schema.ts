import { z } from "zod";
import { SCHEMA_VERSION, type Notebook } from "./types";
import { PAGE_SIZE_LIMITS } from "./units";

/** Hard caps so a hostile or corrupt file can't exhaust memory. */
export const DOC_LIMITS = {
  pages: 2000,
  layersPerPage: 64,
  elementsPerLayer: 20000,
  pointsPerStroke: 20000,
  textChars: 20000,
  latexChars: 4000,
  svgChars: 500_000,
  titleChars: 200,
} as const;

const finite = z.number().finite();
const id = z.string().min(1).max(128);
const color = z.string().regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
const provenance = { groupId: id.optional(), blockId: id.optional() };
const audio = z.object({ audioId: id, ts: z.number().min(0) }).optional();
const point = z.object({ x: finite, y: finite });

const strokeSchema = z
  .object({
    id,
    ...provenance,
    type: z.literal("stroke"),
    tool: z.enum(["pen", "highlighter", "whiteout"]),
    color,
    width: z.number().positive().max(500),
    widths: z.array(z.number().nonnegative().max(500)).max(DOC_LIMITS.pointsPerStroke).optional(),
    points: z.array(point).min(1).max(DOC_LIMITS.pointsPerStroke),
    lineStyle: z.enum(["plain", "dash", "dashdot", "dot"]).optional(),
    fill: color.optional(),
    audio,
  })
  .refine((s) => !s.widths || s.widths.length === s.points.length, { message: "widths must match points" });

const textSchema = z.object({
  id,
  ...provenance,
  type: z.literal("text"),
  x: finite,
  y: finite,
  text: z.string().max(DOC_LIMITS.textChars),
  font: z.string().min(1).max(100),
  size: z.number().positive().max(500),
  color,
  audio,
});

const box = { x: finite, y: finite, w: z.number().positive(), h: z.number().positive() };

const imageSchema = z.object({ id, ...provenance, type: z.literal("image"), ...box, blobId: id });

const texSchema = z.object({
  id,
  ...provenance,
  type: z.literal("tex"),
  ...box,
  latex: z.string().max(DOC_LIMITS.latexChars),
  svg: z.string().max(DOC_LIMITS.svgChars),
});

export const elementSchema = z.union([strokeSchema, textSchema, imageSchema, texSchema]);

const layerSchema = z.object({
  id,
  name: z.string().max(DOC_LIMITS.titleChars),
  visible: z.boolean(),
  author: z.enum(["user", "ai"]),
  elements: z.array(elementSchema).max(DOC_LIMITS.elementsPerLayer),
});

const backgroundSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("solid"),
    style: z.enum(["plain", "lined", "ruled", "graph", "dotted", "isoDotted", "isoGraph", "staves"]),
    color,
  }),
  z.object({ kind: z.literal("pdf"), blobId: id, pageNo: z.number().int().min(1) }),
  z.object({ kind: z.literal("image"), blobId: id }),
]);

const size = z.number().min(PAGE_SIZE_LIMITS.min).max(PAGE_SIZE_LIMITS.max);

const pageSchema = z.object({
  id,
  width: size,
  height: size,
  background: backgroundSchema,
  layers: z.array(layerSchema).min(1).max(DOC_LIMITS.layersPerPage),
});

export const notebookSchema = z.object({
  id,
  title: z.string().min(1).max(DOC_LIMITS.titleChars),
  schemaVersion: z.literal(SCHEMA_VERSION),
  createdAt: finite,
  updatedAt: finite,
  pages: z.array(pageSchema).min(1).max(DOC_LIMITS.pages),
});

export class NotebookFormatError extends Error {}

/** Validate a v4 notebook. Throws NotebookFormatError with a short reason. */
export function parseNotebook(data: unknown): Notebook {
  const v = (data as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (typeof v === "number" && v > SCHEMA_VERSION) {
    throw new NotebookFormatError("This notebook was made by a newer version of Margin. Please update.");
  }
  const r = notebookSchema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new NotebookFormatError(`Invalid notebook: ${issue.path.join(".") || "root"} — ${issue.message}`);
  }
  return r.data as Notebook;
}
