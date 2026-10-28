import { z } from "zod";
import { SCHEMA_VERSION, type Element, type Layer, type Notebook, type Page, type Stroke } from "@/lib/xdoc/types";
import { newId } from "@/lib/xdoc/factories";
import { parseNotebook } from "@/lib/xdoc/schema";
import { PT_PER_PX } from "@/lib/xdoc/units";

/**
 * One-way importer for exports made by the previous Margin AI editor
 * (envelope `format: "margin-ai-notebook"`, document schema v1–v3).
 * Self-contained so it survives deletion of the old editor code.
 *
 * Old documents use CSS px (96 dpi); v4 uses points, so every length is
 * scaled by 0.75. Background data URLs are returned as blobs for the caller
 * to store; the page references them by id.
 */

export class LegacyImportError extends Error {}

/** Baseline offset used by v4 text (y is the top of the first line). */
export const TEXT_ASCENT = 0.8;
const AI_INK = "#1d4ed8";

const num = z.number().finite();
const legacyPoint = z.object({ x: num, y: num, pressure: z.number().min(0).max(1).optional() });
const legacyStroke = z.object({
  id: z.string().min(1),
  points: z.array(legacyPoint).min(1).max(20000),
  color: z.string().min(1).max(40),
  width: z.number().positive().max(500),
  tool: z.enum(["pen", "highlighter"]),
});
const base = { id: z.string().min(1), groupId: z.string().optional(), blockId: z.string().optional() };
const legacyElement = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("text"), x: num, y: num, text: z.string().max(20000), font: z.enum(["hand", "mono"]), size: z.number().positive(), color: z.string().optional() }),
  z.object({ ...base, type: z.literal("line"), x1: num, y1: num, x2: num, y2: num, width: z.number().positive().optional(), color: z.string().optional() }),
  z.object({ ...base, type: z.literal("rect"), x: num, y: num, w: z.number().positive(), h: z.number().positive(), fill: z.string().optional(), stroke: z.string().optional() }),
]);
const legacyLayer = z.object({
  id: z.string().min(1),
  name: z.string().max(200),
  author: z.enum(["user", "ai"]),
  visible: z.boolean(),
  strokes: z.array(legacyStroke).max(20000),
  elements: z.array(legacyElement).max(20000).default([]),
});
const legacyPage = z.object({
  id: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
  paperStyle: z.enum(["blank", "ruled", "grid"]),
  layers: z.array(legacyLayer).min(1).max(64),
  background: z
    .object({ dataUrl: z.string().max(8_000_000).regex(/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/) })
    .passthrough()
    .optional(),
});
const legacyNotebook = z.object({
  title: z.string().min(1).max(200),
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  createdAt: num,
  pages: z.array(legacyPage).min(1).max(2000),
});

export type ImportedBlob = { id: string; kind: "image"; data: Blob };
export type LegacyImport = { notebook: Notebook; blobs: ImportedBlob[] };

/** Detect a legacy export (envelope or bare v1–v3 document). */
export function isLegacyExport(data: unknown): boolean {
  const d = data as { format?: unknown; schemaVersion?: unknown } | null;
  if (!d || typeof d !== "object") return false;
  if (d.format === "margin-ai-notebook") return true;
  return d.schemaVersion === 1 || d.schemaVersion === 2 || d.schemaVersion === 3;
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** Normalize "#abc" / "#aabbcc" / anything else → #rrggbb. */
export function normalizeColor(c: string | undefined, fallback: string): string {
  if (!c || !HEX.test(c)) return fallback;
  if (c.length === 4) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`.toLowerCase();
  return c.toLowerCase();
}

function dataUrlToBlob(url: string): Blob {
  const [head, b64] = url.split(",");
  const mime = head.slice(5, head.indexOf(";"));
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const S = PT_PER_PX;

function convertStroke(s: z.infer<typeof legacyStroke>): Stroke {
  const width = s.width * S;
  const hasPressure = s.points.some((p) => p.pressure !== undefined);
  return {
    id: newId(),
    type: "stroke",
    tool: s.tool,
    color: normalizeColor(s.color, "#000000"),
    width,
    points: s.points.map((p) => ({ x: p.x * S, y: p.y * S })),
    ...(hasPressure ? { widths: s.points.map((p) => width * (p.pressure == null ? 1 : 0.4 + 1.2 * p.pressure)) } : {}),
  };
}

function convertElement(e: z.infer<typeof legacyElement>): Element {
  const prov = { ...(e.groupId ? { groupId: e.groupId } : {}), ...(e.blockId ? { blockId: e.blockId } : {}) };
  if (e.type === "text") {
    const size = e.size * S;
    return { id: newId(), ...prov, type: "text", x: e.x * S, y: e.y * S - size * TEXT_ASCENT, text: e.text, font: e.font === "hand" ? "margin-hand" : "monospace", size, color: normalizeColor(e.color, AI_INK) };
  }
  if (e.type === "line") {
    return { id: newId(), ...prov, type: "stroke", tool: "pen", color: normalizeColor(e.color, "#334155"), width: (e.width ?? 1.5) * S, points: [{ x: e.x1 * S, y: e.y1 * S }, { x: e.x2 * S, y: e.y2 * S }] };
  }
  const x = e.x * S, y = e.y * S, w = e.w * S, h = e.h * S;
  return {
    id: newId(), ...prov, type: "stroke", tool: "pen",
    color: normalizeColor(e.stroke ?? e.fill, "#334155"),
    width: 0.75,
    points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }],
    ...(e.fill ? { fill: normalizeColor(e.fill, "#ffffff") } : {}),
  };
}

const PAPER = { blank: "plain", ruled: "lined", grid: "graph" } as const;

export function importLegacy(data: unknown): LegacyImport {
  const raw = (data as { format?: unknown; notebook?: unknown })?.format === "margin-ai-notebook" ? (data as { notebook: unknown }).notebook : data;
  const r = legacyNotebook.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new LegacyImportError(`Not a valid Margin AI export: ${i.path.join(".") || "root"} — ${i.message}`);
  }
  const blobs: ImportedBlob[] = [];
  const pages: Page[] = r.data.pages.map((p) => {
    const layers: Layer[] = p.layers.map((l) => ({
      id: newId(),
      name: l.name || (l.author === "ai" ? "AI" : "Layer"),
      visible: l.visible,
      author: l.author,
      elements: [...l.strokes.map(convertStroke), ...l.elements.map(convertElement)],
    }));
    if (!layers.some((l) => l.author === "user")) layers.unshift({ id: newId(), name: "Layer 1", visible: true, author: "user", elements: [] });
    let background: Page["background"] = { kind: "solid", style: PAPER[p.paperStyle], color: "#ffffff" };
    if (p.background) {
      const id = newId();
      blobs.push({ id, kind: "image", data: dataUrlToBlob(p.background.dataUrl) });
      background = { kind: "image", blobId: id };
    }
    return { id: newId(), width: p.width * S, height: p.height * S, background, layers };
  });
  const now = Date.now();
  // Validate the converted document with the v4 schema before handing it out.
  const notebook = parseNotebook({ id: newId(), title: r.data.title, schemaVersion: SCHEMA_VERSION, createdAt: r.data.createdAt, updatedAt: now, pages });
  return { notebook, blobs };
}
