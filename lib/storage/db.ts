import { openDB, type IDBPDatabase } from "idb";
import type { Notebook, NotebookMeta } from "@/lib/document/types";
import { parseNotebook } from "@/lib/document/schema";

const DB_NAME = "margin-ai";
const DB_VERSION = 1;
const STORE = "notebooks";
const META_STORE = "meta";

export class StorageError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "StorageError";
  }
}

function unavailable(): never {
  throw new StorageError("IndexedDB is not available in this browser");
}

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (typeof indexedDB === "undefined") unavailable();
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE);
        }
      },
    });
  }
  return dbPromise;
}

/** Test hook: reset the cached connection (e.g. after fake-indexeddb reset). */
export function _resetDBForTests() {
  dbPromise = null;
}

export async function saveNotebook(nb: Notebook): Promise<void> {
  const db = await getDB();
  await db.put(STORE, nb);
}

export async function loadNotebook(id: string): Promise<Notebook | undefined> {
  const db = await getDB();
  const data: unknown = await db.get(STORE, id);
  return data === undefined ? undefined : parseNotebook(data);
}

export async function deleteNotebook(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
}

export async function listNotebooks(): Promise<NotebookMeta[]> {
  const db = await getDB();
  const all: unknown[] = await db.getAll(STORE);
  return all
    .map(parseNotebook)
    .map((n) => ({ id: n.id, title: n.title, pageCount: n.pages.length, updatedAt: n.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function setLastOpened(id: string | null): Promise<void> {
  const db = await getDB();
  if (id === null) await db.delete(META_STORE, "lastOpened");
  else await db.put(META_STORE, id, "lastOpened");
}

export async function getLastOpened(): Promise<string | null> {
  const db = await getDB();
  return (await db.get(META_STORE, "lastOpened")) ?? null;
}
