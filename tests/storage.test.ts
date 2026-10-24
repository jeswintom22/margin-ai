// @vitest-environment node
import "fake-indexeddb/auto"; // registers IDBRequest, IDBKeyRange, etc. globals
import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createNotebook, createStroke, userLayer } from "@/lib/document/types";

// Point idb at the fake implementation, then re-import the module under test.
async function freshDB() {
  (globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory();
  const mod = await import("@/lib/storage/db");
  mod._resetDBForTests();
  return mod;
}

describe("IndexedDB repository", () => {
  let db: Awaited<ReturnType<typeof freshDB>>;

  beforeEach(async () => {
    db = await freshDB();
  });

  it("saves and reloads a notebook", async () => {
    const nb = createNotebook("Persisted");
    userLayer(nb.pages[0]).strokes.push(
      createStroke(
        [
          { x: 1, y: 1 },
          { x: 50, y: 80 },
        ],
        { color: "#111", width: 2, tool: "pen" }
      )
    );
    await db.saveNotebook(nb);
    const loaded = await db.loadNotebook(nb.id);
    expect(loaded?.title).toBe("Persisted");
    expect(loaded?.pages[0].layers[0].strokes).toHaveLength(1);
  });

  it("lists notebook metadata sorted by recency", async () => {
    const a = createNotebook("A");
    await db.saveNotebook(a);
    const b = createNotebook("B");
    b.updatedAt = a.updatedAt + 1000;
    await db.saveNotebook(b);
    const list = await db.listNotebooks();
    expect(list.map((m) => m.title)).toEqual(["B", "A"]);
    expect(list[0].pageCount).toBe(1);
  });

  it("deletes notebooks", async () => {
    const nb = createNotebook("Doomed");
    await db.saveNotebook(nb);
    await db.deleteNotebook(nb.id);
    expect(await db.loadNotebook(nb.id)).toBeUndefined();
  });

  it("remembers the last opened notebook", async () => {
    const nb = createNotebook("Last");
    await db.saveNotebook(nb);
    await db.setLastOpened(nb.id);
    expect(await db.getLastOpened()).toBe(nb.id);
    await db.setLastOpened(null);
    expect(await db.getLastOpened()).toBeNull();
  });
});
