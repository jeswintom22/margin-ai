import { z } from "zod";
import type { Notebook } from "@/lib/xdoc/types";
import { parseNotebook } from "@/lib/xdoc/schema";
import { newId } from "@/lib/xdoc/factories";
import { importLegacy, isLegacyExport } from "./legacyImport";
import type { BlobKind } from "@/lib/store/db";

/**
 * Margin notebook file (.margin.json): the v4 document plus every blob it
 * references, base64-encoded, so one file fully restores the notebook.
 * Import also accepts exports from the previous editor (converted one-way).
 */
export const FILE_FORMAT = "margin-notebook";
export const FILE_VERSION = 2;
/** Whole-file cap (PDF blobs are the bulk). */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

export type FileBlob = { id: string; kind: BlobKind; mime: string; data: Blob };
export type ParsedFile = { notebook: Notebook; blobs: FileBlob[]; legacy: boolean };

export class FileFormatError extends Error {}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function serializeFile(nb: Notebook, blobs: FileBlob[]): Promise<string> {
  const enc = await Promise.all(
    blobs.map(async (b) => ({ id: b.id, kind: b.kind, mime: b.mime, base64: toBase64(new Uint8Array(await b.data.arrayBuffer())) }))
  );
  return JSON.stringify({ format: FILE_FORMAT, formatVersion: FILE_VERSION, notebook: nb, blobs: enc });
}

const fileSchema = z.object({
  format: z.literal(FILE_FORMAT),
  formatVersion: z.literal(FILE_VERSION),
  notebook: z.unknown(),
  blobs: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        kind: z.enum(["pdf", "image", "audio"]),
        mime: z.string().max(100),
        base64: z.string().regex(/^[A-Za-z0-9+/=]*$/),
      })
    )
    .max(5000),
});

/** Parse a .margin.json (or legacy Margin AI .json). The notebook gets a fresh id. */
export function parseFile(text: string): ParsedFile {
  if (text.length > MAX_FILE_BYTES * 1.4) throw new FileFormatError("File is too large.");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new FileFormatError("File is not valid JSON.");
  }
  if (isLegacyExport(data)) {
    const { notebook, blobs } = importLegacy(data);
    return { notebook, blobs: blobs.map((b) => ({ ...b, mime: b.data.type })), legacy: true };
  }
  const r = fileSchema.safeParse(data);
  if (!r.success) throw new FileFormatError("Not a Margin notebook file.");
  const notebook = parseNotebook(r.data.notebook);
  const blobs = r.data.blobs.map((b) => ({ id: b.id, kind: b.kind, mime: b.mime, data: new Blob([fromBase64(b.base64) as BlobPart], { type: b.mime }) }));
  return { notebook: { ...notebook, id: newId(), updatedAt: Date.now() }, blobs, legacy: false };
}
