import { describe, expect, it } from "vitest";
import { importLegacy, isLegacyExport, normalizeColor, LegacyImportError, TEXT_ASCENT } from "@/lib/io/legacyImport";
import { parseFile, serializeFile, FileFormatError } from "@/lib/io/jsonFile";
import { createNotebook } from "@/lib/xdoc/factories";
import type { Stroke, TextEl } from "@/lib/xdoc/types";

// Real shape of a v1 export from the previous editor.
const v1 = {
  format: "margin-ai-notebook", formatVersion: 1,
  notebook: {
    id: "old", title: "Old v1 notebook", schemaVersion: 1, createdAt: 1, updatedAt: 2,
    pages: [{ id: "p1", title: "Legacy", width: 794, height: 1123, paperStyle: "ruled", eraserOperations: [],
      layers: [{ id: "l1", name: "Ink", author: "user", visible: true,
        strokes: [{ id: "s1", points: [{ x: 100, y: 100, pressure: 0.5 }, { x: 300, y: 120, pressure: 1 }], color: "#000", width: 2, tool: "pen", author: "user" }] }] }],
  },
};

const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// v3: AI layer with semantic elements + PDF raster background.
const v3 = {
  id: "n3", title: "Tutor", schemaVersion: 3, createdAt: 5, updatedAt: 6,
  pages: [{ id: "p", title: "", width: 794, height: 1123, paperStyle: "grid", eraserOperations: [],
    background: { dataUrl: PNG_1PX, width: 1, height: 1 },
    layers: [
      { id: "u", name: "Notes", author: "user", visible: true, strokes: [], elements: [] },
      { id: "a", name: "AI", author: "ai", visible: false, strokes: [], elements: [
        { id: "t", groupId: "g", blockId: "b", type: "text", x: 40, y: 80, text: "x²", font: "hand", size: 20 },
        { id: "ln", groupId: "g", blockId: "b", type: "line", x1: 0, y1: 0, x2: 40, y2: 0 },
        { id: "r", groupId: "g", blockId: "b", type: "rect", x: 0, y: 0, w: 40, h: 20, fill: "#fff" },
      ] },
    ] }],
};

describe("legacy import", () => {
  it("detects legacy files", () => {
    expect(isLegacyExport(v1)).toBe(true);
    expect(isLegacyExport(v3)).toBe(true);
    expect(isLegacyExport({ format: "margin-notebook" })).toBe(false);
  });

  it("converts a v1 export: px → pt, ruled → lined, pressure → widths", () => {
    const { notebook } = importLegacy(v1);
    const p = notebook.pages[0];
    expect(p.width).toBeCloseTo(595.5);
    expect(p.background).toEqual({ kind: "solid", style: "lined", color: "#ffffff" });
    const s = p.layers[0].elements[0] as Stroke;
    expect(s.color).toBe("#000000");
    expect(s.points[0]).toEqual({ x: 75, y: 75 });
    expect(s.width).toBe(1.5);
    expect(s.widths).toEqual([1.5 * 1, 1.5 * 1.6]);
    expect(notebook.id).not.toBe("old");
  });

  it("converts v3 AI elements and the raster background", () => {
    const { notebook, blobs } = importLegacy(v3);
    const p = notebook.pages[0];
    expect(p.background.kind).toBe("image");
    expect(blobs).toHaveLength(1);
    expect(blobs[0].data.type).toBe("image/png");
    const ai = p.layers[1];
    expect(ai.author).toBe("ai");
    expect(ai.visible).toBe(false);
    const t = ai.elements[0] as TextEl;
    expect(t.font).toBe("margin-hand");
    expect(t.y).toBeCloseTo(60 - 15 * TEXT_ASCENT);
    expect(t.groupId).toBe("g");
    const rect = ai.elements[2] as Stroke;
    expect(rect.points).toHaveLength(5);
    expect(rect.fill).toBe("#ffffff");
  });

  it("rejects malformed legacy data with a readable error", () => {
    expect(() => importLegacy({ format: "margin-ai-notebook", notebook: { title: "x", schemaVersion: 1, pages: [] } })).toThrow(LegacyImportError);
  });

  it("normalizes colors", () => {
    expect(normalizeColor("#ABC", "#000000")).toBe("#aabbcc");
    expect(normalizeColor("rgb(1,2,3)", "#000000")).toBe("#000000");
  });
});

describe("v4 file round trip", () => {
  it("serializes notebook + blobs and parses back with a fresh notebook id", async () => {
    const nb = createNotebook("Round");
    nb.pages[0].layers[0].elements.push({ id: "i", type: "image", x: 0, y: 0, w: 10, h: 10, blobId: "b1" });
    const text = await serializeFile(nb, [{ id: "b1", kind: "image", mime: "image/png", data: new Blob([new Uint8Array([1, 2, 3, 250])], { type: "image/png" }) }]);
    const back = parseFile(text);
    expect(back.legacy).toBe(false);
    expect(back.notebook.id).not.toBe(nb.id);
    expect(back.notebook.pages).toEqual(nb.pages);
    expect([...new Uint8Array(await back.blobs[0].data.arrayBuffer())]).toEqual([1, 2, 3, 250]);
  });

  it("parseFile routes legacy files through the converter", () => {
    expect(parseFile(JSON.stringify(v1)).legacy).toBe(true);
  });

  it("rejects non-JSON and foreign JSON", () => {
    expect(() => parseFile("nope")).toThrow(FileFormatError);
    expect(() => parseFile(JSON.stringify({ hello: 1 }))).toThrow(FileFormatError);
  });
});
