// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { pdfToPages, readPdfFile, PdfImportError, PDF_LIMITS, type PdfDocLike } from "@/lib/pdf/importPdf";
import { parseNotebook, MAX_BACKGROUND_CHARS } from "@/lib/document/schema";
import { serializeNotebook, importNotebookJSON } from "@/lib/storage/exportImport";
import { createNotebook, createPage, createStroke, userLayer, SCHEMA_VERSION, type Notebook } from "@/lib/document/types";
import { PNG_1PX } from "./helpers/images";

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";

/** Fake pdf.js doc: `n` pages of 612×792pt (US Letter). */
function fakeDoc(n: number, failOn?: number): PdfDocLike & { destroy: ReturnType<typeof vi.fn> } {
  return {
    numPages: n,
    destroy: vi.fn().mockResolvedValue(undefined),
    getPage: async (i) => ({
      getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }),
      render: () => ({ promise: i === failOn ? Promise.reject(new Error("bad page")) : Promise.resolve() }),
    }),
  };
}

function fakeCanvas() {
  const c = { width: 0, height: 0, getContext: () => ({ fillStyle: "", fillRect: vi.fn() }), toDataURL: vi.fn(() => JPEG) };
  return c as unknown as HTMLCanvasElement;
}

describe("PDF import", () => {
  it("renders each page to a background sized to the notebook width", async () => {
    const doc = fakeDoc(3);
    const pages = await pdfToPages(new Uint8Array(), { name: "hw", loader: async () => doc, createCanvas: fakeCanvas });
    expect(pages).toHaveLength(3);
    expect(pages[0]).toMatchObject({ title: "hw p.1", width: 794, height: Math.round((794 * 792) / 612) });
    expect(pages[0].background).toMatchObject({ dataUrl: JPEG, width: PDF_LIMITS.renderWidth });
    expect(doc.destroy).toHaveBeenCalled();
  });

  it("enforces the page limit and fails without partial output", async () => {
    await expect(pdfToPages(new Uint8Array(), { loader: async () => fakeDoc(31), createCanvas: fakeCanvas })).rejects.toThrow(PdfImportError);
    await expect(pdfToPages(new Uint8Array(), { loader: async () => fakeDoc(2, 2), createCanvas: fakeCanvas })).rejects.toThrow("bad page");
  });

  it("rejects oversized and non-PDF files before parsing", async () => {
    const file = (bytes: Uint8Array, size = bytes.length) => ({ size, arrayBuffer: async () => bytes.buffer as ArrayBuffer });
    await expect(readPdfFile(file(new Uint8Array(4), PDF_LIMITS.maxBytes + 1))).rejects.toThrow(/too large/);
    await expect(readPdfFile(file(new TextEncoder().encode("hello")))).rejects.toThrow(/not a PDF/);
    expect(await readPdfFile(file(new TextEncoder().encode("%PDF-1.7 ...")))).toHaveLength(12);
  });

  it("propagates friendly loader errors (encrypted/corrupt)", async () => {
    const loader = async () => { throw new PdfImportError("This PDF is password-protected. Remove the password and try again."); };
    await expect(pdfToPages(new Uint8Array(), { loader })).rejects.toThrow(/password/);
  });
});

function withBackground(): Notebook {
  const nb = createNotebook("pdf");
  nb.pages[0] = { ...createPage("hw p.1", "blank"), height: 1027, background: { dataUrl: JPEG, width: 1588, height: 2055, label: "hw" } };
  userLayer(nb.pages[0]).strokes.push(createStroke([{ x: 1, y: 1 }, { x: 5, y: 5 }], { color: "#000", width: 2, tool: "pen" }));
  return nb;
}

describe("schema v3 backgrounds", () => {
  it("round-trips backgrounds through export/import", () => {
    const nb = withBackground();
    const back = importNotebookJSON(serializeNotebook(nb));
    expect(back.pages[0].background).toEqual(nb.pages[0].background);
    expect(back.pages[0].height).toBe(1027);
    expect(userLayer(back.pages[0]).strokes).toHaveLength(1);
  });

  it("rejects invalid or oversized backgrounds", () => {
    const bad = (bg: object) => ({ ...withBackground(), pages: [{ ...withBackground().pages[0], background: bg }] });
    expect(() => parseNotebook(bad({ dataUrl: "javascript:alert(1)", width: 1, height: 1 }))).toThrow();
    expect(() => parseNotebook(bad({ dataUrl: "data:image/svg+xml;base64,AAAA", width: 1, height: 1 }))).toThrow();
    expect(() => parseNotebook(bad({ dataUrl: "data:image/png;base64," + "A".repeat(MAX_BACKGROUND_CHARS), width: 1, height: 1 }))).toThrow();
    expect(parseNotebook(bad({ dataUrl: `data:image/png;base64,${PNG_1PX}`, width: 8, height: 8 })).pages[0].background?.width).toBe(8);
  });

  it("migrates a real v1 export and a v2 document to v3 unchanged", () => {
    const v1 = {
      id: "nb1", title: "Old", schemaVersion: 1, createdAt: 1, updatedAt: 2,
      pages: [{ id: "p1", title: "One", width: 794, height: 1123, paperStyle: "ruled", eraserOperations: [],
        layers: [{ id: "l1", name: "Ink", author: "user", visible: true,
          strokes: [{ id: "s1", points: [{ x: 1, y: 2 }], color: "#000", width: 2, tool: "pen", author: "user" }] }] }],
    };
    const m1 = parseNotebook(v1);
    expect(m1.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m1.pages[0].layers[0]).toMatchObject({ id: "l1", strokes: [{ id: "s1" }], elements: [] });
    expect(m1.pages[0].background).toBeUndefined();

    const v2 = { ...m1, schemaVersion: 2 };
    const m2 = parseNotebook(v2);
    expect(m2).toEqual(m1);
    expect(parseNotebook(m2)).toEqual(m2); // idempotent
    expect(v1.schemaVersion).toBe(1); // input not mutated
    // v2 had no background field: the v2 validator strips it, so nothing unvalidated leaks into v3.
    const smuggled = parseNotebook({ ...v2, pages: [{ ...v2.pages[0], background: { dataUrl: "javascript:x", width: 1, height: 1 } }] });
    expect(smuggled.pages[0].background).toBeUndefined();
  });

  it("persists backgrounds in IndexedDB across reload", async () => {
    (globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory();
    const db = await import("@/lib/storage/db");
    db._resetDBForTests();
    const nb = withBackground();
    await db.saveNotebook(nb);
    db._resetDBForTests();
    const loaded = await db.loadNotebook(nb.id);
    expect(loaded?.pages[0].background).toEqual(nb.pages[0].background);
  });
});
