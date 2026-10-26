"use client";

import type { EditorTool } from "@/lib/document/types";
import type { SaveStatus } from "@/hooks/useNotebook";
import type { MenuSection } from "@/components/menu/menuModel";
import MenuBar from "@/components/menu/MenuBar";

/** Xournal++-style palette: the app's own colors plus the common pickers. */
const COLORS = ["#1a1a1a", "#d92626", "#e6a100", "#1a8f4a", "#1d6fd8", "#7c3aed", "#ffffff"];
const WIDTHS = [1.5, 2.5, 4, 7];

type Props = {
  title: string;
  tool: EditorTool;
  color: string;
  strokeWidth: number;
  canUndo: boolean;
  canRedo: boolean;
  saveStatus: SaveStatus;
  sidebarOpen: boolean;
  /** App menu tree (File/View/Settings/Help) rendered by MenuBar/MobileSheet. */
  menus: MenuSection[];
  onOpenAppMenu: () => void;
  onRename: (t: string) => void;
  onTool: (t: EditorTool) => void;
  onColor: (c: string) => void;
  onWidth: (w: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddPage: () => void;
  onToggleSidebar: () => void;
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
  kebab: "M12 5.5h.01M12 12h.01M12 18.5h.01",
};

const statusText: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed — retrying",
};

const Sep = () => <div className="mx-1 h-6 w-px bg-neutral-300" aria-hidden />;

export default function Toolbar(p: Props) {
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
      <MenuBar menus={p.menus} />
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
      </div>

      <div className="flex-1" />

      <TB title="Add page" label="+ Page" onClick={p.onAddPage}><I d={ICONS.page} /></TB>
      <span
        role="status"
        aria-live="polite"
        className={`ml-1 hidden w-20 text-right text-[11px] md:block ${p.saveStatus === "error" ? "text-red-600" : "text-neutral-400"}`}
      >
        {statusText[p.saveStatus]}
      </span>
      <button
        type="button"
        id="app-menu-btn"
        aria-label="Menu"
        title="Menu"
        onClick={p.onOpenAppMenu}
        className="flex h-9 w-9 items-center justify-center rounded-md text-neutral-700 transition-colors hover:bg-neutral-200/70 sm:hidden"
      >
        <I d={ICONS.kebab} className="h-5 w-5" />
      </button>
    </header>
  );
}
