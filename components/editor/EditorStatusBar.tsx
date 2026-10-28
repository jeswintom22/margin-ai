"use client";

import { useState } from "react";
import type { Editor } from "@/lib/engine/Editor";
import { useEditorUI } from "@/hooks/useEditor";
import { Icon, ICONS } from "./icons";

const TOOL_NAMES: Record<string, string> = { pen: "Pen", highlighter: "Highlighter", eraser: "Eraser", hand: "Hand" };
const ERASER_NAMES = { standard: "Standard", whiteout: "Whiteout", stroke: "Delete stroke" } as const;

/** Xournal++-style status bar: page navigation, page size, layer, tool. */
export default function EditorStatusBar({ editor }: { editor: Editor }) {
  const pageIndex = useEditorUI(editor, (u) => u.pageIndex);
  const pageCount = useEditorUI(editor, (u) => u.pageCount);
  const tool = useEditorUI(editor, (u) => u.tool);
  const eraserMode = useEditorUI(editor, (u) => u.settings.eraserMode);
  useEditorUI(editor, (u) => u.rev);
  const [draft, setDraft] = useState<string | null>(null);
  const page = editor.currentPage;
  const layerId = editor.currentLayerId(page.id);
  const layer = page.layers.find((l) => l.id === layerId && l.author === "user") ?? [...page.layers].reverse().find((l) => l.author === "user");
  const mm = (pt: number) => Math.round((pt / 72) * 25.4);
  const goto = (i: number) => {
    const p = editor.doc.pages[Math.max(0, Math.min(pageCount - 1, i))];
    if (p) editor.setCurrentPage(p.id);
  };
  const cell = "flex items-center border-r border-neutral-300 px-3 last:border-r-0";
  const nav = "flex h-6 w-6 items-center justify-center rounded hover:bg-neutral-200 disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-blue-600";
  return (
    <footer className="flex h-8 shrink-0 items-center overflow-hidden whitespace-nowrap border-t border-neutral-300 bg-[#f5f5f4] text-[11px] text-neutral-600">
      <span className={`${cell} gap-1 px-2`}>
        <button type="button" aria-label="Previous page" title="Previous page (PgUp)" className={nav} disabled={pageIndex === 0} onClick={() => goto(pageIndex - 1)}>
          <Icon d={ICONS.prev} className="h-3.5 w-3.5" />
        </button>
        Page
        <input
          aria-label="Go to page"
          inputMode="numeric"
          className="w-9 rounded border border-neutral-300 bg-white px-1 text-center tabular-nums"
          value={draft ?? String(pageIndex + 1)}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (draft) goto(Number(draft) - 1);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <span data-testid="page-indicator" className="tabular-nums">of {pageCount}</span>
        <button type="button" aria-label="Next page" title="Next page (PgDn)" className={nav} disabled={pageIndex >= pageCount - 1} onClick={() => goto(pageIndex + 1)}>
          <Icon d={ICONS.next} className="h-3.5 w-3.5" />
        </button>
      </span>
      <span className={`${cell} max-sm:hidden`}>{mm(page.width)} × {mm(page.height)} mm</span>
      <span className={`${cell} max-sm:hidden`}>Layer: {layer?.name ?? "—"}</span>
      <span className={cell}>{TOOL_NAMES[tool] ?? tool}{tool === "eraser" ? ` · ${ERASER_NAMES[eraserMode]}` : ""}</span>
    </footer>
  );
}
