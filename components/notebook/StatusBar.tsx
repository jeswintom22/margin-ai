"use client";

import type { EditorTool } from "@/lib/document/types";

const TOOL_NAMES: Record<EditorTool, string> = {
  pen: "Pen",
  highlighter: "Highlighter",
  eraser: "Eraser",
  select: "Rectangle select",
  lasso: "Lasso select",
};

/** Xournal++-style status bar: tool, page position, ink counts. */
export default function StatusBar({
  tool,
  pageIndex,
  pageCount,
  userStrokes,
  aiElements,
  selected,
  voiceOn,
}: {
  tool: EditorTool;
  pageIndex: number;
  pageCount: number;
  userStrokes: number;
  aiElements: number;
  selected: number;
  voiceOn: boolean;
}) {
  const cell = "flex items-center gap-1.5 border-r border-neutral-300 px-3 last:border-r-0";
  return (
    <footer className="flex h-7 shrink-0 items-center border-t border-neutral-300 bg-[#f5f5f4] text-[11px] text-neutral-600">
      <span className={cell}>{TOOL_NAMES[tool]}</span>
      <span className={cell}>Page {pageIndex + 1} of {pageCount}</span>
      <span className={cell}>{userStrokes} stroke{userStrokes === 1 ? "" : "s"}</span>
      {aiElements > 0 && <span className={cell}>{aiElements} AI element{aiElements === 1 ? "" : "s"}</span>}
      {selected > 0 && <span className={`${cell} font-medium text-blue-700`}>{selected} selected</span>}
      <span className="flex-1" />
      <span className={`${cell} ${voiceOn ? "text-red-600" : "text-neutral-400"}`}>
        {voiceOn ? "● Listening — Ctrl+M to stop" : "Ctrl+M to talk to the notebook"}
      </span>
    </footer>
  );
}
