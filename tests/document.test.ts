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
