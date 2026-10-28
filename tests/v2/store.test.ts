import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import * as db from "@/lib/store/db";
import { createNotebook } from "@/lib/xdoc/factories";
import type { Notebook } from "@/lib/xdoc/types";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  db._resetDBForTests();
});

const withImage = (nb: Notebook, blobId: string) => {
  nb.pages[0].layers[0].elements.push({ id: "i", type: "image", x: 0, y: 0, w: 10, h: 10, blobId });
  return nb;
};

describe("store v4", () => {
  it("saves, lists and reloads notebooks", async () => {
    const a = createNotebook("A");
    const b = createNotebook("B");
    b.updatedAt = a.updatedAt + 10;
    await db.saveNotebook(a);
    await db.saveNotebook(b);
    expect((await db.listNotebooks()).map((m) => m.title)).toEqual(["B", "A"]);
    expect(await db.loadNotebook(a.id)).toEqual(a);
  });

  it("rejects a corrupt stored notebook on load", async () => {
    const d = await db.getDB();
    await d.put("notebooks", { id: "bad", title: "x", schemaVersion: 4, pages: [] });
    await expect(db.loadNotebook("bad")).rejects.toThrow();
  });

  it("stores blobs and garbage-collects unreferenced ones on delete", async () => {
    const used = await db.putBlob(new Blob(["png"], { type: "image/png" }), "image");
    const orphan = await db.putBlob(new Blob(["x"]), "image");
    const nb = withImage(createNotebook("A"), used);
    await db.saveNotebook(nb);
    expect(await db.gcBlobs()).toBe(1);
    expect(await db.getBlob(orphan)).toBeUndefined();
    expect((await db.getBlob(used))?.kind).toBe("image");
    await db.deleteNotebook(nb.id);
    expect(await db.getBlob(used)).toBeUndefined();
  });

  it("gc keeps blobs referenced by another notebook or the open document", async () => {
    const shared = await db.putBlob(new Blob(["a"]), "image");
    const unsaved = await db.putBlob(new Blob(["b"]), "image");
    await db.saveNotebook(withImage(createNotebook("A"), shared));
    const other = withImage(createNotebook("B"), shared);
    await db.saveNotebook(other);
    await db.deleteNotebook(other.id);
    expect(await db.getBlob(shared)).toBeDefined();
    expect(await db.gcBlobs([unsaved])).toBe(0);
  });

  it("collects refs from pdf backgrounds and audio links", () => {
    const nb = createNotebook("A");
    nb.pages[0].background = { kind: "pdf", blobId: "pdf1", pageNo: 1 };
    nb.pages[0].layers[0].elements.push({ id: "s", type: "stroke", tool: "pen", color: "#000000", width: 1, points: [{ x: 0, y: 0 }], audio: { audioId: "aud1", ts: 5 } });
    expect([...db.blobRefs(nb)].sort()).toEqual(["aud1", "pdf1"]);
  });

  it("meta values round-trip and clear", async () => {
    await db.setMeta("lastOpened", "abc");
    expect(await db.getMeta("lastOpened")).toBe("abc");
    await db.setMeta("lastOpened", null);
    expect(await db.getMeta("lastOpened")).toBeUndefined();
  });
});
