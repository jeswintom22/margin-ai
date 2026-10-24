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

const pageElementSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1), groupId: z.string().min(1), blockId: z.string().min(1),
    type: z.literal("text"),
    x: z.number().finite(), y: z.number().finite(),
    text: z.string(),
    font: z.enum(["hand", "mono"]),
    size: z.number().positive(),
    bold: z.boolean().optional(),
    color: z.string().optional(),
  }),
  z.object({
    id: z.string().min(1), groupId: z.string().min(1), blockId: z.string().min(1),
    type: z.literal("line"),
    x1: z.number().finite(), y1: z.number().finite(),
    x2: z.number().finite(), y2: z.number().finite(),
    width: z.number().positive().optional(),
    color: z.string().optional(),
  }),
  z.object({
    id: z.string().min(1), groupId: z.string().min(1), blockId: z.string().min(1),
    type: z.literal("rect"),
    x: z.number().finite(), y: z.number().finite(),
    w: z.number().positive(), h: z.number().positive(),
    fill: z.string().optional(),
    stroke: z.string().optional(),
  }),
]);

const layerSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  author: z.enum(["user", "ai"]),
  visible: z.boolean(),
  strokes: z.array(strokeSchema),
  elements: z.array(pageElementSchema).default([]),
});

const layerSchemaV1 = layerSchema.omit({ elements: true });

const pageSchemaV1 = z.object({
  id: z.string().min(1),
  title: z.string().default(""),
  width: z.number().positive(),
  height: z.number().positive(),
  paperStyle: z.enum(["blank", "ruled", "grid"]),
  layers: z.array(layerSchemaV1).min(1),
  eraserOperations: z.array(eraserOpSchema).default([]),
});

const notebookSchemaV1 = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  pages: z.array(pageSchemaV1).min(1),
  schemaVersion: z.literal(1),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const pageSchemaV2 = z.object({
  id: z.string().min(1),
  title: z.string().default(""),
  width: z.number().positive(),
  height: z.number().positive(),
  paperStyle: z.enum(["blank", "ruled", "grid"]),
  layers: z.array(layerSchema).min(1),
  eraserOperations: z.array(eraserOpSchema).default([]),
});

/** Max data-URL length for one page background (~6 MB of base64). */
export const MAX_BACKGROUND_CHARS = 8_000_000;

const pageSchema = pageSchemaV2.extend({
  background: z
    .object({
      dataUrl: z.string().max(MAX_BACKGROUND_CHARS).regex(/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/),
      width: z.number().int().positive().max(8192),
      height: z.number().int().positive().max(8192),
      label: z.string().max(200).optional(),
    })
    .optional(),
});

const notebookSchemaV2 = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  pages: z.array(pageSchemaV2).min(1),
  schemaVersion: z.literal(2),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const notebookSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  pages: z.array(pageSchema).min(1),
  schemaVersion: z.literal(SCHEMA_VERSION),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const exportFileSchema = z.object({
  format: z.literal("margin-ai-notebook"),
  formatVersion: z.literal(1),
  notebook: z.unknown(),
});

export type ExportFile = Omit<z.infer<typeof exportFileSchema>, "notebook"> & { notebook: Notebook };

/**
 * Validate and migrate a parsed JSON value into a Notebook.
 * Throws on invalid input. Migrates older schema versions forward.
 */
export function parseNotebook(data: unknown): Notebook {
  return migrateNotebook(data);
}

export function parseExportFile(data: unknown): Notebook {
  const parsed = exportFileSchema.parse(data);
  return migrateNotebook(parsed.notebook);
}

/**
 * Forward-migrate a notebook to SCHEMA_VERSION. Consecutive steps only:
 * each version is validated by its own schema, transformed without mutating
 * the input, and the result is validated by the current schema.
 * v1 → v2 adds the `elements` array to every layer; v2 → v3 adds the optional
 * locked page `background` (imported PDF pages).
 */
export function migrateNotebook(data: unknown): Notebook {
  const { schemaVersion } = z.object({ schemaVersion: z.number().int() }).parse(data);
  if (schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `Notebook schema version ${schemaVersion} is newer than supported version ${SCHEMA_VERSION}. Update Margin AI to open this notebook; the original data has not been changed.`
    );
  }
  if (schemaVersion < 1) {
    throw new Error(
      `Unsupported notebook schema version ${schemaVersion}. Supported versions: 1-${SCHEMA_VERSION}.`
    );
  }
  let input = data;
  for (let v = schemaVersion; v < SCHEMA_VERSION; v++) {
    switch (v) {
      case 1: {
        const doc = notebookSchemaV1.parse(input);
        input = {
          ...doc,
          schemaVersion: 2,
          pages: doc.pages.map((p) => ({
            ...p,
            layers: p.layers.map((l) => ({ ...l, elements: [] })),
          })),
        };
        break;
      }
      case 2: {
        // v2 -> v3 adds the optional page `background`; existing pages have none.
        const doc = notebookSchemaV2.parse(input);
        input = { ...doc, schemaVersion: 3 };
        break;
      }
      default:
        throw new Error(`Missing migration step for schema version ${v}`);
    }
  }
  const doc = notebookSchema.parse(input);
  for (const page of doc.pages) {
    if (!page.layers.some((l) => l.author === "user")) {
      throw new Error(`Page ${page.id} has no user layer`);
    }
  }
  return doc;
}
