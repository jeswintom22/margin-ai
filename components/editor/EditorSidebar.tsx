"use client";

import { useState } from "react";
import type { Editor } from "@/lib/engine/Editor";
import type { AssetCache } from "@/lib/engine/render/assets";
import type { NotebookMeta } from "@/lib/xdoc/types";
import { useEditorUI } from "@/hooks/useEditor";
import PageThumb from "./PageThumb";

type Tab = "pages" | "notebooks";

const mini =
  "flex h-7 min-w-7 items-center justify-center rounded px-1 text-xs text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-blue-600";

/**
 * Left sidebar with Xournal++-style tabs. Page actions are undoable, so they
 * act immediately; deleting a notebook is not, so it asks first.
 */
export default function EditorSidebar({
  editor, assets, metas, onOpen, onCreate, onDelete, onImport,
}: {
  editor: Editor;
  assets: AssetCache;
  metas: NotebookMeta[];
  onOpen: (id: string) => void;
  onCreate: (title: string) => void;
  onDelete: (id: string) => void;
  onImport: () => void;
}) {
  const [tab, setTab] = useState<Tab>("pages");
  const rev = useEditorUI(editor, (u) => u.rev);
  const currentPageId = useEditorUI(editor, (u) => u.currentPageId);
  const [dragId, setDragId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  void rev; // re-render on document changes (pages mutate in place)
  const pages = editor.doc.pages;

  return (
    <aside className="flex w-[180px] shrink-0 flex-col border-r border-neutral-300 bg-[#efeeeb] max-sm:absolute max-sm:inset-y-0 max-sm:left-0 max-sm:z-30 max-sm:shadow-2xl">
      <div role="tablist" aria-label="Sidebar" className="flex border-b border-neutral-300 text-xs">
        {(["pages", "notebooks"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 font-medium capitalize ${tab === t ? "border-b-2 border-blue-600 text-blue-800" : "text-neutral-500 hover:text-neutral-800"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "pages" ? (
        <ol aria-label="Pages" className="flex-1 space-y-3 overflow-y-auto px-2 py-3">
          {pages.map((p, i) => {
            const active = p.id === currentPageId;
            return (
              <li
                key={p.id}
                draggable
                onDragStart={(e) => {
                  setDragId(p.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => dragId && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId) editor.movePage(dragId, i);
                  setDragId(null);
                }}
                onDragEnd={() => setDragId(null)}
                className="group flex flex-col items-center"
              >
                <button
                  type="button"
                  aria-label={`Page ${i + 1}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => editor.setCurrentPage(p.id)}
                  className={`rounded-sm p-0.5 ${active ? "ring-2 ring-blue-500" : "ring-1 ring-neutral-300 hover:ring-neutral-400"} ${dragId === p.id ? "opacity-40" : ""}`}
                >
                  <PageThumb editor={editor} page={p} assets={assets} />
                </button>
                <div className="mt-1 flex w-full items-center justify-between text-[11px] text-neutral-500">
                  <span className="pl-1 tabular-nums">{i + 1}</span>
                  <span className="flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                    <button type="button" aria-label={`Move page ${i + 1} up`} title="Move up" className={mini} disabled={i === 0} onClick={() => editor.movePage(p.id, i - 1)}>↑</button>
                    <button type="button" aria-label={`Move page ${i + 1} down`} title="Move down" className={mini} disabled={i === pages.length - 1} onClick={() => editor.movePage(p.id, i + 1)}>↓</button>
                    <button type="button" aria-label={`Duplicate page ${i + 1}`} title="Duplicate" className={mini} onClick={() => editor.duplicatePage(p.id)}>⧉</button>
                    <button type="button" aria-label={`Delete page ${i + 1}`} title="Delete (undoable)" className={`${mini} hover:text-red-600`} disabled={pages.length <= 1} onClick={() => editor.deletePage(p.id)}>✕</button>
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <ul aria-label="Notebooks" className="flex-1 overflow-y-auto p-2">
            {metas.map((m) => (
              <li key={m.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onOpen(m.id)}
                  aria-current={m.id === editor.doc.id ? "true" : undefined}
                  className={`min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm ${m.id === editor.doc.id ? "bg-white font-medium text-neutral-900 shadow-sm" : "text-neutral-600 hover:bg-white/60"}`}
                >
                  {m.title} <span className="text-xs text-neutral-400">({m.pageCount})</span>
                </button>
                {confirmDel === m.id ? (
                  <span className="flex">
                    <button type="button" className={`${mini} text-red-600`} onClick={() => { setConfirmDel(null); onDelete(m.id); }}>Delete</button>
                    <button type="button" className={mini} onClick={() => setConfirmDel(null)}>Keep</button>
                  </span>
                ) : (
                  <button type="button" aria-label={`Delete notebook ${m.title}`} className={`${mini} opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100`} onClick={() => setConfirmDel(m.id)}>✕</button>
                )}
              </li>
            ))}
          </ul>
          <form
            className="flex gap-1 border-t border-neutral-300 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              onCreate(newName);
              setNewName("");
            }}
          >
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New notebook…" aria-label="New notebook name" className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm" />
            <button type="submit" aria-label="Create notebook" className="rounded-md bg-neutral-900 px-2 text-sm text-white">+</button>
          </form>
          <button type="button" onClick={onImport} className="mx-2 mb-2 rounded-md border border-dashed border-neutral-400 px-2 py-1.5 text-xs text-neutral-600 hover:bg-white/60">
            Import notebook…
          </button>
        </div>
      )}
    </aside>
  );
}
