import { z } from "zod";

/**
 * Structured answer schema for the assistant.
 *
 * The model's output is untrusted input: everything is validated against this
 * schema before reaching the client. Provider-side structured output is only a
 * hint — this Zod schema is the actual contract.
 *
 * Client-safe: no secrets. Rendering must be done through typed components —
 * block content is never HTML and must not reach dangerouslySetInnerHTML.
 *
 * LaTeX fields are opaque strings for now; they are displayed as text until a
 * math renderer is added, and later phases may convert them to strokes.
 */

export const ANSWER_SCHEMA_VERSION = 1;

// ---- limits ---------------------------------------------------------------

export const LIMITS = {
  title: 120,
  text: 2000,
  blocks: 40,
  listItems: 30,
  listDepth: 3,
  tableRows: 24,
  tableCols: 8,
  tableCell: 300,
  code: 4000,
  language: 30,
  latex: 2000,
  derivationSteps: 20,
  stepNote: 500,
  steps: 20,
  diagramPrimitives: 20,
  label: 200,
  annotations: 10,
  followUps: 5,
  followUp: 120,
  summary: 500,
  warnings: 10,
  blockId: 64,
  /** Raw model content ceiling — larger payloads are rejected before parsing. */
  rawResponseChars: 64_000,
} as const;

const id = z.string().min(1).max(LIMITS.blockId);
const text = z.string().min(1).max(LIMITS.text);

// ---- blocks ---------------------------------------------------------------

export interface ListItem {
  text: string;
  children?: ListItem[];
}

const listItemSchema: z.ZodType<ListItem> = z.lazy(() =>
  z.object({
    text: z.string().min(1).max(LIMITS.stepNote),
    children: z.array(listItemSchema).max(LIMITS.listItems).optional(),
  })
);

/** Items nested deeper than `LIMITS.listDepth` are rejected. */
const boundedListItem = (depth: number): z.ZodType<ListItem> =>
  depth >= LIMITS.listDepth
    ? z.object({ text: z.string().min(1).max(LIMITS.stepNote), children: z.undefined().optional() })
    : z.lazy(() =>
        z.object({
          text: z.string().min(1).max(LIMITS.stepNote),
          children: z.array(boundedListItem(depth + 1)).max(LIMITS.listItems).optional(),
        })
      ) as z.ZodType<ListItem>;

const coordinate = z.number().finite().min(0).max(100); // normalized diagram space

const diagramPrimitiveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("line"), from: z.object({ x: coordinate, y: coordinate }), to: z.object({ x: coordinate, y: coordinate }) }),
  z.object({ type: z.literal("arrow"), from: z.object({ x: coordinate, y: coordinate }), to: z.object({ x: coordinate, y: coordinate }) }),
  z.object({ type: z.literal("box"), x: coordinate, y: coordinate, w: z.number().positive().max(100), h: z.number().positive().max(100), label: z.string().max(LIMITS.label).optional() }),
  z.object({ type: z.literal("ellipse"), x: coordinate, y: coordinate, w: z.number().positive().max(100), h: z.number().positive().max(100), label: z.string().max(LIMITS.label).optional() }),
  z.object({ type: z.literal("label"), x: coordinate, y: coordinate, text: z.string().min(1).max(LIMITS.label) }),
]);

export const answerBlockSchema = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("paragraph"), text }),
  z.object({ id, type: z.literal("heading"), level: z.union([z.literal(1), z.literal(2), z.literal(3)]), text }),
  z.object({
    id,
    type: z.literal("list"),
    style: z.enum(["bulleted", "numbered"]),
    items: z.array(boundedListItem(1)).min(1).max(LIMITS.listItems),
  }),
  z.object({ id, type: z.literal("callout"), kind: z.enum(["note", "tip", "warning"]), text }),
  z.object({ id, type: z.literal("math"), latex: z.string().min(1).max(LIMITS.latex), display: z.boolean().default(true) }),
  z.object({
    id,
    type: z.literal("derivation"),
    steps: z
      .array(z.object({ latex: z.string().min(1).max(LIMITS.latex), note: z.string().max(LIMITS.stepNote).optional() }))
      .min(1)
      .max(LIMITS.derivationSteps),
  }),
  z.object({ id, type: z.literal("definition"), term: z.string().min(1).max(LIMITS.label), definition: text }),
  z.object({
    id,
    type: z.literal("code"),
    language: z.string().min(1).max(LIMITS.language),
    code: z.string().min(1).max(LIMITS.code),
    explanation: z.string().max(LIMITS.text).optional(),
  }),
  z.object({
    id,
    type: z.literal("steps"),
    title: z.string().max(LIMITS.label).optional(),
    items: z.array(z.string().min(1).max(LIMITS.stepNote)).min(1).max(LIMITS.steps),
  }),
  z.object({
    id,
    type: z.literal("table"),
    headers: z.array(z.string().max(LIMITS.tableCell)).min(1).max(LIMITS.tableCols),
    rows: z
      .array(z.array(z.string().max(LIMITS.tableCell)).min(1).max(LIMITS.tableCols))
      .max(LIMITS.tableRows),
  }),
  z.object({
    id,
    type: z.literal("diagram"),
    title: z.string().max(LIMITS.label).optional(),
    primitives: z.array(diagramPrimitiveSchema).min(1).max(LIMITS.diagramPrimitives),
  }),
  z.object({ id, type: z.literal("annotation"), text: z.string().min(1).max(LIMITS.text), targetBlockId: id.optional() }),
]);

export type AnswerBlock = z.infer<typeof answerBlockSchema>;
export type DiagramPrimitive = z.infer<typeof diagramPrimitiveSchema>;

// ---- metadata -------------------------------------------------------------

/**
 * `verificationStatus` is always "unverified" today: no deterministic
 * validation or execution step exists yet, so answers may not be labeled
 * verified. A future phase can add real verification and widen this.
 */
export const answerMetadataSchema = z.object({
  requestId: z.string().max(64).optional(),
  model: z.string().max(100).optional(),
  generatedAt: z.number().int().positive().optional(),
  language: z.string().max(10).optional(),
  warnings: z.array(z.string().max(200)).max(LIMITS.warnings).optional(),
  verificationStatus: z.literal("unverified").default("unverified"),
});

export type AnswerMetadata = z.infer<typeof answerMetadataSchema>;

// ---- document -------------------------------------------------------------

export const answerDocumentSchema = z.object({
  schemaVersion: z.literal(ANSWER_SCHEMA_VERSION),
  title: z.string().min(1).max(LIMITS.title),
  blocks: z.array(answerBlockSchema).min(1).max(LIMITS.blocks),
  summary: z.string().max(LIMITS.summary).optional(),
  followUpSuggestions: z.array(z.string().min(1).max(LIMITS.followUp)).max(LIMITS.followUps).optional(),
  metadata: answerMetadataSchema.optional(),
});

export type AnswerDocument = z.infer<typeof answerDocumentSchema>;
export type AnswerBlockType = AnswerBlock["type"];

export const ANSWER_BLOCK_TYPES = [
  "paragraph", "heading", "list", "callout", "math", "derivation",
  "definition", "code", "steps", "table", "diagram", "annotation",
] as const satisfies readonly AnswerBlockType[];

/** Validate parsed JSON against the schema. Throws ZodError on failure. */
export function parseAnswerDocument(data: unknown): AnswerDocument {
  return answerDocumentSchema.parse(data);
}
