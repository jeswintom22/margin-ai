import type { Notebook } from "@/lib/document/types";
import { parseExportFile, type ExportFile } from "@/lib/document/schema";
import { newId } from "@/lib/document/types";

export function serializeNotebook(nb: Notebook): string {
  const file: ExportFile = { format: "margin-ai-notebook", formatVersion: 1, notebook: nb };
  return JSON.stringify(file, null, 2);
}

export function downloadNotebook(nb: Notebook) {
  const blob = new Blob([serializeNotebook(nb)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nb.title.replace(/[^\w\- ]/g, "").trim() || "notebook"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Parse an exported file. Returns a notebook with a fresh id so importing
 * never collides with an existing notebook. Throws on invalid input.
 */
export function importNotebookJSON(text: string): Notebook {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON");
  }
  const nb = parseExportFile(data);
  nb.id = newId();
  nb.updatedAt = Date.now();
  return nb;
}
