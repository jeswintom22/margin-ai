"use client";

import { useState } from "react";
import type { NotebookMeta, NotebookPage } from "@/lib/document/types";

type Props = {
  open: boolean;
  metas: NotebookMeta[];
  activeNotebookId: string | null;
  pages: NotebookPage[];
  activePageId: string | null;
  onOpenNotebook: (id: string) => void;
  onAddNotebook: (title: string) => void;
  onDeleteNotebook: (id: string) => void;
  onImport: (text: string) => Promise<{ ok: boolean; error?: string }>;
  onSelectPage: (id: string) => void;
  onAddPage: () => void;
  onRenamePage: (id: string, title: string) => void;
  onDeletePage: (id: string) => void;
  onMovePage: (id: string, dir: -1 | 1) => void;
};

export default function Sidebar(p: Props) {
  const [newName, setNewName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  if (!p.open) return null;

  const doImport = (file: File) => {
    file.text().then(async (text) => {
      const res = await p.onImport(text);
      setImportError(res.ok ? null : (res.error ?? "Import failed"));
    });
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 max-sm:absolute max-sm:z-20 max-sm:h-full max-sm:shadow-xl">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Notebooks</h2>
      </div>

      <ul className="max-h-48 overflow-y-auto px-2" aria-label="Notebooks">
        {p.metas.map((m) => (
          <li key={m.id} className="group flex items-center">
            <button
              type="button"
              onClick={() => p.onOpenNotebook(m.id)}
              className={`flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm ${
                m.id === p.activeNotebookId
                  ? "bg-neutral-200 font-medium text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {m.title}
              <span className="ml-1 text-xs text-neutral-400">({m.pageCount})</span>
            </button>
            <button
              type="button"
              aria-label={`Delete notebook ${m.title}`}
              title="Delete notebook"
              onClick={() => {
                if (window.confirm(`Delete notebook "${m.title}"? This cannot be undone.`))
                  p.onDeleteNotebook(m.id);
              }}
              className="hidden h-7 w-7 rounded text-neutral-400 hover:bg-red-50 hover:text-red-600 group-hover:block"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <form
        className="flex gap-1 px-2 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) {
            p.onAddNotebook(newName.trim());
            setNewName("");
          }
        }}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New notebook…"
          aria-label="New notebook name"
          className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
        />
        <button type="submit" className="rounded-md bg-neutral-900 px-2 text-sm text-white">+</button>
      </form>

      <label className="mx-2 mb-2 cursor-pointer rounded-md border border-dashed border-neutral-300 px-2 py-1.5 text-center text-xs text-neutral-500 hover:bg-neutral-100">
        Import notebook (.json)
        <input
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])}
        />
      </label>
      {importError && <p className="mx-2 mb-2 text-xs text-red-600">{importError}</p>}

      <div className="mx-3 border-t border-neutral-200" />

      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Pages</h2>
        <button
          type="button"
          onClick={p.onAddPage}
          className="rounded px-1.5 py-0.5 text-sm text-neutral-600 hover:bg-neutral-200"
          title="Add page"
        >
          +
        </button>
      </div>

      <ul className="flex-1 overflow-y-auto px-2 pb-3" aria-label="Pages">
        {p.pages.map((pg, i) => (
          <li key={pg.id} className="group flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => p.onSelectPage(pg.id)}
              onDoubleClick={() => {
                const t = window.prompt("Page title", pg.title);
                if (t != null) p.onRenamePage(pg.id, t);
              }}
              title="Click to open · double-click to rename"
              className={`flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm ${
                pg.id === p.activePageId
                  ? "bg-blue-100 font-medium text-blue-900"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {i + 1}. {pg.title || "Untitled"}
            </button>
            <span className="hidden group-hover:flex">
              <button type="button" aria-label="Move page up" title="Move up"
                onClick={() => p.onMovePage(pg.id, -1)}
                className="h-6 w-5 rounded text-xs text-neutral-400 hover:bg-neutral-200">↑</button>
              <button type="button" aria-label="Move page down" title="Move down"
                onClick={() => p.onMovePage(pg.id, 1)}
                className="h-6 w-5 rounded text-xs text-neutral-400 hover:bg-neutral-200">↓</button>
              <button type="button" aria-label={`Delete page ${pg.title}`} title="Delete page"
                onClick={() => {
                  if (window.confirm(`Delete page "${pg.title || "Untitled"}"?`)) p.onDeletePage(pg.id);
                }}
                className="h-6 w-5 rounded text-xs text-neutral-400 hover:bg-red-50 hover:text-red-600">×</button>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
