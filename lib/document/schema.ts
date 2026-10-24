import { z } from "zod";
import { SCHEMA_VERSION, type Notebook } from "./types";

const pointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  pressure: z.number().min(0).max(1).optional(),
  time: z.number().optional(),
});

const strokeSchema = z.object({
  id: z.string().min(1),
  points: z.array(pointSchema).min(1),
  color: z.string().min(1),
  width: z.number().positive(),
  tool: z.enum(["pen", "highlighter"]),
  author: z.enum(["user", "ai"]),
});

const eraserOpSchema = z.object({
  id: z.string().min(1),
  targetStrokeIds: z.array(z.string()),
  at: z.number(),
});

const layerSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  author: z.enum(["user", "ai"]),
  visible: z.boolean(),
  strokes: z.array(strokeSchema),
});

const pageSchema = z.object({
  id: z.string().min(1),
  title: z.string().default(""),
  width: z.number().positive(),
  height: z.number().positive(),
  paperStyle: z.enum(["blank", "ruled", "grid"]),
  layers: z.array(layerSchema).min(1),
  eraserOperations: z.array(eraserOpSchema).default([]),
});

const notebookSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  pages: z.array(pageSchema).min(1),
  schemaVersion: z.number().int().positive(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const exportFileSchema = z.object({
  format: z.literal("margin-ai-notebook"),
  formatVersion: z.literal(1),
  notebook: notebookSchema,
});

export type ExportFile = z.infer<typeof exportFileSchema>;

/**
 * Validate and migrate a parsed JSON value into a Notebook.
 * Throws on invalid input. Migrates older schema versions forward.
 */
export function parseNotebook(data: unknown): Notebook {
  const parsed = notebookSchema.parse(data);
  return migrateNotebook(parsed as Notebook);
}

export function parseExportFile(data: unknown): Notebook {
  const parsed = exportFileSchema.parse(data);
  return migrateNotebook(parsed.notebook as Notebook);
}

/**
 * Forward-migrate a notebook to SCHEMA_VERSION.
 * v1 is current; the switch is the extension point for future versions.
 */
export function migrateNotebook(nb: Notebook): Notebook {
  if (nb.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `Notebook schema version ${nb.schemaVersion} is newer than supported version ${SCHEMA_VERSION}`
    );
  }
  let v = nb.schemaVersion;
  const doc = { ...nb };
  while (v < SCHEMA_VERSION) {
    switch (v) {
      // case 1: ...upgrade v1 -> v2...; break;
      default:
        v = SCHEMA_VERSION;
    }
  }
  doc.schemaVersion = SCHEMA_VERSION;
  for (const page of doc.pages) {
    if (!page.layers.some((l) => l.author === "user")) {
      throw new Error(`Page ${page.id} has no user layer`);
    }
  }
  return doc;
}
