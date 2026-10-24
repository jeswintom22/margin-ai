"use client";

import type { EditorTool, PaperStyle } from "@/lib/document/types";
import type { SaveStatus } from "@/hooks/useNotebook";

/** Xournal++-style palette: the app's own colors plus the common pickers. */
const COLORS = ["#1a1a1a", "#d92626", "#e6a100", "#1a8f4a", "#1d6fd8", "#7c3aed", "#ffffff"];
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
  onImportPdf: (file: File) => void;
  pdfBusy: boolean;
  /** Number of AI elements on the current page; AI controls show only when > 0. */
  aiCount: number;
  aiVisible: boolean;
  onToggleAI: () => void;
  onClearAI: () => void;
};

/** Classic toolbar icon button (icon-only, tooltip, like Xournal++). */
function TB({
  active, title, onClick, disabled, label, children,
}: {
  active?: boolean; title: string; onClick: () => void; disabled?: boolean; label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label ?? title}
      aria-pressed={active}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-9 min-w-9 items-center justify-center gap-1 rounded-md border px-2 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600
        ${active
          ? "border-blue-300 bg-blue-50 text-blue-700"
          : "border-transparent text-neutral-700 hover:bg-neutral-200/70"}
        ${disabled ? "cursor-not-allowed opacity-35" : ""}`}
    >
      {children}
      {label && <span className="hidden text-[11px] md:inline">{label}</span>}
    </button>
  );
}

const I = ({ d, className = "h-[18px] w-[18px]" }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    <path d={d} />
  </svg>
);
const ICONS = {
  menu: "M4 6h16M4 12h16M4 18h16",
  pen: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z",
  highlighter: "M9 11l6 6M15 4l5 5-8.5 8.5H7.5V13.5L15 4zM5 21h14",
  eraser: "M16 3l5 5-9.5 9.5H7L3 13.5 12 5l4-2zM6 21h12",
  select: "M5 3h12v12H5zM9 15l4 6",
  lasso: "M12 4a7 7 0 1 0 0 14M12 18l-1 3M6 8c-2 0-3 .9-3 2",
  undo: "M9 14 4 9l5-5M4 9h9a7 7 0 0 1 0 14h-3",
  redo: "m15 14 5-5-5-5M20 9h-9a7 7 0 0 0 0 14h3",
  page: "M6 3h9l4 4v14H6zM15 3v4h4",
  pdf: "M6 3h9l4 4v14H6zM15 3v4h4M9 14h6M9 17h6",
  download: "M12 4v12m0 0 5-5m-5 5-5-5M5 20h14",
  sparkles: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z",
};

const statusText: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed — retrying",
};

const Sep = () => <div className="mx-1 h-6 w-px bg-neutral-300" aria-hidden />;

export default function Toolbar(p: Props) {
  const textBtn =
    "flex h-9 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-neutral-700 transition-colors hover:bg-neutral-200/70 disabled:opacity-40";
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-neutral-300 bg-[#f5f5f4] px-2 sm:px-3">
      <button
        type="button"
        aria-label="Toggle sidebar"
        title="Pages & notebooks"
        onClick={p.onToggleSidebar}
        className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-neutral-200/70 ${p.sidebarOpen ? "text-neutral-900" : "text-neutral-500"}`}
      >
        <I d={ICONS.menu} />
      </button>
      <input
        aria-label="Notebook title"
        className="w-28 shrink truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-neutral-800 hover:border-neutral-300 hover:bg-white focus:border-blue-400 focus:bg-white focus:outline-none lg:w-44"
        defaultValue={p.title}
        key={p.title}
        onBlur={(e) => p.onRename(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <Sep />

      {/* Xournal++-style tool strip */}
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto" role="toolbar" aria-label="Drawing tools">
        <TB active={p.tool === "pen"} title="Pen (P)" onClick={() => p.onTool("pen")}><I d={ICONS.pen} /></TB>
        <TB active={p.tool === "highlighter"} title="Highlighter (H)" onClick={() => p.onTool("highlighter")}><I d={ICONS.highlighter} /></TB>
        <TB active={p.tool === "eraser"} title="Eraser (E)" onClick={() => p.onTool("eraser")}><I d={ICONS.eraser} /></TB>
        <TB active={p.tool === "select"} title="Select (S)" onClick={() => p.onTool("select")}><I d={ICONS.select} /></TB>
        <TB active={p.tool === "lasso"} title="Lasso select (L)" onClick={() => p.onTool("lasso")}><I d={ICONS.lasso} /></TB>
        <Sep />
        <TB title="Undo (Ctrl+Z)" disabled={!p.canUndo} onClick={p.onUndo}><I d={ICONS.undo} /></TB>
        <TB title="Redo (Ctrl+Y)" disabled={!p.canRedo} onClick={p.onRedo}><I d={ICONS.redo} /></TB>
        <Sep />

        <div className="flex items-center gap-1.5 px-1" role="radiogroup" aria-label="Pen color">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={p.color === c}
              aria-label={`Color ${c}`}
              title={`Color ${c}`}
              onClick={() => p.onColor(c)}
              className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 ${p.color === c ? "border-white ring-2 ring-blue-500" : "border-neutral-300"}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <Sep />

        {/* thickness: fine / medium / thick / marker, drawn as dots */}
        <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Stroke width">
          {WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={p.strokeWidth === w}
              aria-label={`Stroke width ${w}px`}
              title={`Thickness ${w}px`}
              onClick={() => p.onWidth(w)}
              className={`flex h-9 w-8 items-center justify-center rounded-md border transition-colors ${p.strokeWidth === w ? "border-blue-300 bg-blue-50" : "border-transparent hover:bg-neutral-200/70"}`}
            >
              <span className="rounded-full" style={{ width: w * 2 + 2, height: w * 2 + 2, backgroundColor: p.color === "#ffffff" ? "#a3a3a3" : p.color }} />
            </button>
          ))}
        </div>
        <Sep />

        <select
          aria-label="Paper style"
          title="Paper style"
          className="h-8 rounded-md border border-neutral-300 bg-white px-1.5 text-xs text-neutral-700"
          value={p.paperStyle}
          onChange={(e) => p.onPaperStyle(e.target.value as PaperStyle)}
        >
          <option value="blank">Blank</option>
          <option value="ruled">Ruled</option>
          <option value="grid">Grid</option>
        </select>
      </div>

      <div className="flex-1" />

      {p.aiCount > 0 && (
        <div className="flex items-center" role="group" aria-label="AI content on this page">
          <button
            type="button"
            onClick={p.onToggleAI}
            aria-pressed={p.aiVisible}
            title={p.aiVisible ? "Hide AI content on this page" : "Show AI content on this page"}
            className={`${textBtn} text-blue-700`}
          >
            <I d={ICONS.sparkles} className="h-4 w-4" />
            <span className="hidden xl:inline">{p.aiVisible ? "AI: shown" : "AI: hidden"}</span>
            <span className="sr-only xl:hidden">{p.aiVisible ? "AI: shown" : "AI: hidden"}</span>
          </button>
          <button type="button" onClick={p.onClearAI} className={textBtn}
            title="Remove AI content from this page (undoable; your ink is untouched)">
            Clear AI
          </button>
        </div>
      )}
      <Sep />
      <TB title="Add page" label="+ Page" onClick={p.onAddPage}><I d={ICONS.page} /></TB>
      <label
        title="Import a PDF: each page becomes a notebook page with the PDF as a locked background"
        className={`hidden h-9 w-9 cursor-pointer items-center justify-center rounded-md text-neutral-700 transition-colors hover:bg-neutral-200/70 sm:flex ${p.pdfBusy ? "pointer-events-none opacity-50" : ""}`}
      >
        {p.pdfBusy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" /> : <I d={ICONS.pdf} />}
        <input
          type="file"
          accept="application/pdf,.pdf"
          aria-label="Import PDF"
          className="sr-only"
          disabled={p.pdfBusy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) p.onImportPdf(f);
          }}
        />
      </label>
      <span className="hidden sm:block">
        <TB title="Export notebook as JSON" label="Export" onClick={p.onExport}><I d={ICONS.download} /></TB>
      </span>
      <span
        role="status"
        aria-live="polite"
        className={`ml-1 hidden w-20 text-right text-[11px] md:block ${p.saveStatus === "error" ? "text-red-600" : "text-neutral-400"}`}
      >
        {statusText[p.saveStatus]}
      </span>
    </header>
  );
}
