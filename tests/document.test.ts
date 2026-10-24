import { describe, it, expect } from "vitest";
import {
  createNotebook,
  createPage,
  createStroke,
  userLayer,
  aiLayer,
  SCHEMA_VERSION,
} from "@/lib/document/types";
import { parseNotebook, migrateNotebook } from "@/lib/document/schema";
import { serializeNotebook, importNotebookJSON } from "@/lib/storage/exportImport";

describe("document model", () => {
  it("creates a notebook with one user-layer page", () => {
    const nb = createNotebook("Test");
    expect(nb.schemaVersion).toBe(SCHEMA_VERSION);
    expect(nb.pages).toHaveLength(1);
    expect(nb.pages[0].layers[0].author).toBe("user");
  });

  it("keeps ai content in a separate layer", () => {
    const page = createPage("p");
    userLayer(page).strokes.push(
      createStroke([{ x: 0, y: 0 }], { color: "#000", width: 2, tool: "pen" })
    );
    const ai = aiLayer(page);
    ai.strokes.push(
      createStroke([{ x: 9, y: 9 }], { color: "#00f", width: 2, tool: "pen", author: "ai" })
    );
    expect(page.layers).toHaveLength(2);
    expect(userLayer(page).strokes[0].author).toBe("user");
    expect(ai.strokes[0].author).toBe("ai");
    // hiding the ai layer doesn't touch user content
    ai.visible = false;
    expect(userLayer(page).visible).toBe(true);
  });
});

describe("validation & migration", () => {
  it("preserves all v1 data without mutating input and is repeatable", () => {
    const nb = createNotebook("Complete notebook");
    nb.pages.push(createPage("Second page", "grid"));
    userLayer(nb.pages[0]).strokes.push(createStroke(
      [{ x: 12, y: 34, pressure: 0.8, time: 25 }],
      { color: "#123456", width: 4, tool: "highlighter" }
    ));
    aiLayer(nb.pages[0]).strokes.push(createStroke(
      [{ x: 56, y: 78 }],
      { color: "#abcdef", width: 2, tool: "pen", author: "ai" }
    ));
    aiLayer(nb.pages[0]).visible = false;
    nb.pages[0].eraserOperations.push({ id: "erase-1", targetStrokeIds: ["removed-1"], at: 123 });
    const before = structuredClone(nb);
    const parsed = parseNotebook(nb);
    expect(parsed).toEqual(before);
    expect(migrateNotebook(parsed)).toEqual(before);
    expect(migrateNotebook(migrateNotebook(nb))).toEqual(before);
    expect(nb).toEqual(before);
    const imported = importNotebookJSON(serializeNotebook(nb));
    expect({ ...imported, id: nb.id, updatedAt: nb.updatedAt }).toEqual(before);
  });

  it.each([0, -1])("rejects unsupported older version %s at every entry point", (schemaVersion) => {
    const nb = { ...createNotebook("Old"), schemaVersion };
    expect(() => migrateNotebook(nb)).toThrow(/unsupported.*schema version/i);
    expect(() => parseNotebook(nb)).toThrow(/unsupported.*schema version/i);
    expect(() => importNotebookJSON(serializeNotebook(nb))).toThrow(/unsupported.*schema version/i);
    expect(nb.schemaVersion).toBe(schemaVersion);
  });

  it.each([undefined, null, "1", 1.5, NaN, Infinity])("rejects malformed version %s", (schemaVersion) => {
    const nb = { ...createNotebook("Malformed"), schemaVersion };
    expect(() => parseNotebook(nb)).toThrow();
    expect(() => migrateNotebook(nb)).toThrow();
    expect(() => importNotebookJSON(JSON.stringify({
      format: "margin-ai-notebook", formatVersion: 1, notebook: nb,
    }))).toThrow();
  });

  it("retains existing v1 page defaults", () => {
    const nb = createNotebook("Defaults");
    const data = JSON.parse(JSON.stringify(nb));
    delete data.pages[0].title;
    delete data.pages[0].eraserOperations;
    const parsed = parseNotebook(data);
    expect(parsed.pages[0].title).toBe("");
    expect(parsed.pages[0].eraserOperations).toEqual([]);
    expect(parseNotebook(parsed)).toEqual(parsed);
  });

  it("validates direct migration calls and export envelopes", () => {
    expect(() => migrateNotebook({ ...createNotebook("Invalid"), pages: [] })).toThrow();
    const nb = createNotebook("Invalid stroke");
    userLayer(nb.pages[0]).strokes.push(createStroke([], { color: "#000", width: 2, tool: "pen" }));
    expect(() => migrateNotebook(nb)).toThrow();
    expect(() => importNotebookJSON(serializeNotebook(nb))).toThrow();
    expect(() => importNotebookJSON(JSON.stringify({
      format: "margin-ai-notebook", formatVersion: 2, notebook: createNotebook("Envelope"),
    }))).toThrow();
  });

  it("gives actionable future-version errors for parsing and import", () => {
    const nb = { ...createNotebook("Future"), schemaVersion: SCHEMA_VERSION + 1 };
    expect(() => parseNotebook(nb)).toThrow(/newer.*update/i);
    expect(() => importNotebookJSON(serializeNotebook(nb))).toThrow(/newer.*update/i);
  });

  it("round-trips through export/import", () => {
    const nb = createNotebook("Round trip");
    userLayer(nb.pages[0]).strokes.push(
      createStroke(
        [
          { x: 1, y: 2, pressure: 0.7, time: 0 },
          { x: 3, y: 4 },
        ],
        { color: "#123", width: 3, tool: "highlighter" }
      )
    );
    const text = serializeNotebook(nb);
    const imported = importNotebookJSON(text);
    expect(imported.title).toBe("Round trip");
    expect(imported.id).not.toBe(nb.id); // fresh id on import
    expect(imported.pages[0].layers[0].strokes[0].points).toHaveLength(2);
  });

  it("rejects malformed documents", () => {
    expect(() => parseNotebook({})).toThrow();
    expect(() => parseNotebook({ id: "x", title: "t", pages: [] })).toThrow();
    expect(() => importNotebookJSON("not json")).toThrow("valid JSON");
    expect(() => importNotebookJSON("{}")).toThrow();
  });

  it("rejects a newer schema version", () => {
    const nb = createNotebook("n");
    nb.schemaVersion = SCHEMA_VERSION + 1;
    expect(() => migrateNotebook(nb)).toThrow(/newer/);
  });

  it("rejects pages without a user layer", () => {
    const nb = createNotebook("n");
    nb.pages[0].layers[0].author = "ai";
    expect(() => migrateNotebook(nb)).toThrow(/user layer/);
  });
});
