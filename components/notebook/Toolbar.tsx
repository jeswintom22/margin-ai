"use client";

import type { EditorTool, PaperStyle } from "@/lib/document/types";
import type { SaveStatus } from "@/hooks/useNotebook";

const COLORS = ["#1a1a1a", "#d92626", "#1d6fd8", "#1a8f4a", "#e6a100", "#7c3aed"];
const WIDTHS = [1.5, 2.5, 4, 7];

type Props = {
  title: string;
  tool: EditorTool;
  color: string;
  strokeWidth: number;
  paperStyle: PaperStyle;
  canUndo: boolean;
  canRedo: boolean;
  saveStatus: SaveStatus;
  sidebarOpen: boolean;
  onRename: (t: string) => void;
  onTool: (t: EditorTool) => void;
  onColor: (c: string) => void;
  onWidth: (w: number) => void;
  onPaperStyle: (s: PaperStyle) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddPage: () => void;
  onToggleSidebar: () => void;
  onExport: () => void;
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  /** Number of AI elements on the current page; AI controls show only when > 0. */
  aiCount: number;
  aiVisible: boolean;
  onToggleAI: () => void;
  onClearAI: () => void;
};

function ToolButton({
  active, label, title, onClick, disabled, children,
}: {
  active?: boolean; label: string; title: string; onClick: () => void; disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      aria-pressed={active}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-9 min-w-9 items-center justify-center gap-1 rounded-md px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600
        ${active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-200"}
        ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
    >
      {children}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

const statusText: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed — retrying",
};

export default function Toolbar(p: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-neutral-200 bg-white px-2 sm:px-3">
      <button
        type="button"
        aria-label="Toggle sidebar"
        onClick={p.onToggleSidebar}
        className="flex h-9 w-9 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-200"
      >
        ☰
      </button>

      <input
        aria-label="Notebook title"
        className="w-28 shrink truncate rounded-md px-2 py-1 text-sm font-semibold text-neutral-800 hover:bg-neutral-100 focus:bg-neutral-100 focus:outline-none sm:w-48"
        defaultValue={p.title}
        key={p.title}
        onBlur={(e) => p.onRename(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />

      <div className="mx-1 h-6 w-px bg-neutral-200" />

      <div className="flex items-center gap-0.5 overflow-x-auto" role="toolbar" aria-label="Drawing tools">
        <ToolButton active={p.tool === "pen"} label="Pen" title="Pen (P)" onClick={() => p.onTool("pen")}>✏️</ToolButton>
        <ToolButton active={p.tool === "highlighter"} label="Highlt" title="Highlighter (H)" onClick={() => p.onTool("highlighter")}>🖍️</ToolButton>
        <ToolButton active={p.tool === "eraser"} label="Erase" title="Eraser (E)" onClick={() => p.onTool("eraser")}>⌫</ToolButton>
        <ToolButton active={p.tool === "select"} label="Select" title="Select (S)" onClick={() => p.onTool("select")}>⬚</ToolButton>
      </div>

      <div className="mx-1 h-6 w-px bg-neutral-200" />

      <ToolButton label="Undo" title="Undo (Ctrl+Z)" disabled={!p.canUndo} onClick={p.onUndo}>↩</ToolButton>
      <ToolButton label="Redo" title="Redo (Ctrl+Y)" disabled={!p.canRedo} onClick={p.onRedo}>↪</ToolButton>

      <div className="mx-1 h-6 w-px bg-neutral-200" />

      <div className="hidden items-center gap-1 sm:flex" role="radiogroup" aria-label="Pen color">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={p.color === c}
            aria-label={`Color ${c}`}
            onClick={() => p.onColor(c)}
            className={`h-5 w-5 rounded-full border ${p.color === c ? "ring-2 ring-neutral-800 ring-offset-1" : "border-neutral-300"}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      <select
        aria-label="Stroke width"
        className="ml-1 h-8 rounded-md border border-neutral-300 bg-white px-1 text-xs text-neutral-700"
        value={p.strokeWidth}
        onChange={(e) => p.onWidth(Number(e.target.value))}
      >
        {WIDTHS.map((w) => (
          <option key={w} value={w}>{w}px</option>
        ))}
      </select>

      <select
        aria-label="Paper style"
        className="h-8 rounded-md border border-neutral-300 bg-white px-1 text-xs text-neutral-700"
        value={p.paperStyle}
        onChange={(e) => p.onPaperStyle(e.target.value as PaperStyle)}
      >
        <option value="blank">Blank</option>
        <option value="ruled">Ruled</option>
        <option value="grid">Grid</option>
      </select>

      <div className="flex-1" />

      {p.aiCount > 0 && (
        <div className="flex items-center gap-0.5" role="group" aria-label="AI content on this page">
          <button
            type="button"
            onClick={p.onToggleAI}
            aria-pressed={p.aiVisible}
            title={p.aiVisible ? "Hide AI content on this page" : "Show AI content on this page"}
            className="h-9 rounded-md border border-blue-200 px-2 text-xs text-blue-700 hover:bg-blue-50"
          >
            {p.aiVisible ? "AI: shown" : "AI: hidden"}
          </button>
          <button
            type="button"
            onClick={p.onClearAI}
            title="Remove AI content from this page (undoable; your ink is untouched)"
            className="h-9 rounded-md border border-neutral-300 px-2 text-xs text-neutral-700 hover:bg-neutral-100"
          >
            Clear AI
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={p.onAddPage}
        className="h-9 rounded-md border border-neutral-300 px-2 text-xs text-neutral-700 hover:bg-neutral-100"
        title="Add page"
      >
        + Page
      </button>
      <button
        type="button"
        onClick={p.onExport}
        className="hidden h-9 rounded-md border border-neutral-300 px-2 text-xs text-neutral-700 hover:bg-neutral-100 sm:block"
        title="Export notebook as JSON"
      >
        Export
      </button>
      <button
        type="button"
        onClick={p.onToggleAssistant}
        aria-pressed={p.assistantOpen}
        className={`h-9 rounded-md border px-2 text-xs ${
          p.assistantOpen
            ? "border-neutral-900 bg-neutral-900 text-white"
            : "border-neutral-300 text-neutral-700 hover:bg-neutral-100"
        }`}
        title="Toggle assistant panel"
      >
        Assistant
      </button>

      <span
        role="status"
        aria-live="polite"
        className={`w-24 text-right text-xs ${
          p.saveStatus === "error" ? "text-red-600" : "text-neutral-500"
        }`}
      >
        {statusText[p.saveStatus]}
      </span>
    </header>
  );
}
