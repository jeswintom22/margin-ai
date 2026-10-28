import { openDB, type IDBPDatabase } from "idb";
import type { Notebook, NotebookMeta } from "@/lib/xdoc/types";
import { parseNotebook } from "@/lib/xdoc/schema";
import { newId } from "@/lib/xdoc/factories";

/**
 * Storage for the v4 editor. A brand-new database (fresh start): the old
 * "margin-ai" database used by the previous editor is never read or touched.
 *
 * Stores:
 * - notebooks: full Notebook JSON (no binary data)
 * - metas:     NotebookMeta for fast library listing
 * - blobs:     PDFs, images, audio — referenced from documents by id
 * - meta:      small key/value settings (last opened, preferences)
 */
const DB_NAME = "margin-notebook-v4";
const DB_VERSION = 1;

export type BlobKind = "pdf" | "image" | "audio";
export type StoredBlob = { id: string; kind: BlobKind; mime: string; data: Blob };

export class StorageError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "StorageError";
  }
}

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (typeof indexedDB === "undefined") throw new StorageError("IndexedDB is not available in this browser");
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      for (const s of ["notebooks", "metas", "blobs"]) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    },
  });
  return dbPromise;
}

/** Test hook: drop the cached connection (after resetting fake-indexeddb). */
export function _resetDBForTests() {
  dbPromise = null;
}

const toMeta = (nb: Notebook): NotebookMeta => ({ id: nb.id, title: nb.title, pageCount: nb.pages.length, updatedAt: nb.updatedAt });

export async function saveNotebook(nb: Notebook): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["notebooks", "metas"], "readwrite");
  await Promise.all([tx.objectStore("notebooks").put(nb), tx.objectStore("metas").put(toMeta(nb)), tx.done]);
}

export async function loadNotebook(id: string): Promise<Notebook | undefined> {
  const data: unknown = await (await getDB()).get("notebooks", id);
  return data === undefined ? undefined : parseNotebook(data);
}

export async function listNotebooks(): Promise<NotebookMeta[]> {
  const all = (await (await getDB()).getAll("metas")) as NotebookMeta[];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Delete a notebook and any blobs no other notebook still references. */
export async function deleteNotebook(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["notebooks", "metas"], "readwrite");
  await Promise.all([tx.objectStore("notebooks").delete(id), tx.objectStore("metas").delete(id), tx.done]);
  await gcBlobs();
}

/** Every blob id referenced by a notebook (backgrounds, images, audio links). */
export function blobRefs(nb: Notebook): Set<string> {
  const refs = new Set<string>();
  for (const p of nb.pages) {
    if (p.background.kind !== "solid") refs.add(p.background.blobId);
    for (const l of p.layers)
      for (const e of l.elements) {
        if (e.type === "image") refs.add(e.blobId);
        if ((e.type === "stroke" || e.type === "text") && e.audio) refs.add(e.audio.audioId);
      }
  }
  return refs;
}

/**
 * Remove blobs referenced by no saved notebook. `keep` protects blobs the
 * open (possibly unsaved) document still uses.
 */
export async function gcBlobs(keep: Iterable<string> = []): Promise<number> {
  const db = await getDB();
  const live = new Set(keep);
  for (const raw of (await db.getAll("notebooks")) as unknown[]) {
    try {
      for (const r of blobRefs(parseNotebook(raw))) live.add(r);
    } catch {
      // A corrupt notebook must not cause its blobs to be deleted: keep everything.
      return 0;
    }
  }
  const ids = (await db.getAllKeys("blobs")) as string[];
  const dead = ids.filter((k) => !live.has(k));
  if (dead.length) {
    const tx = db.transaction("blobs", "readwrite");
    await Promise.all([...dead.map((k) => tx.store.delete(k)), tx.done]);
  }
  return dead.length;
}

export async function putBlob(data: Blob, kind: BlobKind, mime = data.type): Promise<string> {
  const id = newId();
  await putBlobRecord({ id, kind, mime, data });
  return id;
}

/** Store a blob under a known id (file import keeps the ids the document references). */
export async function putBlobRecord(rec: StoredBlob): Promise<void> {
  await (await getDB()).put("blobs", rec);
}

export async function getBlob(id: string): Promise<StoredBlob | undefined> {
  return (await (await getDB()).get("blobs", id)) as StoredBlob | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  if (value === undefined || value === null) await db.delete("meta", key);
  else await db.put("meta", value, key);
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await getDB()).get("meta", key)) as T | undefined;
}
