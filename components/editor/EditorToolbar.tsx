"use client";

import type { Editor } from "@/lib/engine/Editor";
import type { ToolId } from "@/lib/engine/input";
import { PEN_WIDTHS, HIGHLIGHTER_WIDTHS, type EraserMode, type EraserSize } from "@/lib/engine/tools";
import type { LineStyle } from "@/lib/xdoc/types";
import { useEditorUI } from "@/hooks/useEditor";
import type { MenuSection } from "@/components/menu/menuModel";
import MenuBar from "@/components/menu/MenuBar";
import { Icon, ICONS } from "./icons";
import type { SaveState } from "@/lib/storage/autosave";

/** Xournal++-like palette. */
export const PALETTE = [
  { c: "#000000", n: "Black" }, { c: "#808080", n: "Gray" }, { c: "#3333cc", n: "Blue" }, { c: "#00c0ff", n: "Light blue" },
  { c: "#008000", n: "Green" }, { c: "#00ff00", n: "Light green" }, { c: "#ffff00", n: "Yellow" }, { c: "#ff8000", n: "Orange" },
  { c: "#ff0000", n: "Red" }, { c: "#ff00ff", n: "Magenta" }, { c: "#ffffff", n: "White" },
];

const TOOLS: { id: ToolId; label: string; key: string; icon: string }[] = [
  { id: "pen", label: "Pen", key: "P", icon: ICONS.pen },
  { id: "highlighter", label: "Highlighter", key: "H", icon: ICONS.highlighter },
  { id: "eraser", label: "Eraser", key: "E", icon: ICONS.eraser },
  { id: "hand", label: "Hand", key: "Space", icon: ICONS.hand },
];

const saveText: Record<SaveState, string> = { idle: "", saving: "Saving…", saved: "Saved", error: "Save failed — retrying" };

const tb = (active?: boolean) =>
  `flex h-9 min-w-9 shrink-0 items-center justify-center gap-1 rounded-md border px-1.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-35 ${
    active ? "border-blue-300 bg-blue-50 text-blue-700" : "border-transparent text-neutral-700 hover:bg-neutral-200/70"
  }`;

const Sep = () => <div className="mx-1 h-6 w-px shrink-0 bg-neutral-300" aria-hidden />;

export default function EditorToolbar({
  editor, menus, saveStatus, onToggleSidebar, onOpenSheet,
}: {
  editor: Editor;
  menus: MenuSection[];
  saveStatus: SaveState;
  onToggleSidebar: () => void;
  onOpenSheet: () => void;
}) {
  const tool = useEditorUI(editor, (u) => u.tool);
  const s = useEditorUI(editor, (u) => u.settings);
  const canUndo = useEditorUI(editor, (u) => u.canUndo);
  const canRedo = useEditorUI(editor, (u) => u.canRedo);
  const undoLabel = useEditorUI(editor, (u) => u.undoLabel);
  const redoLabel = useEditorUI(editor, (u) => u.redoLabel);
  const title = useEditorUI(editor, (u) => u.title);

  const widths = tool === "highlighter" ? HIGHLIGHTER_WIDTHS : PEN_WIDTHS;
  const curWidth = tool === "highlighter" ? s.highlighterWidth : s.penWidth;
  const setWidth = (w: number) => editor.updateSettings(tool === "highlighter" ? { highlighterWidth: w } : { penWidth: w });

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-neutral-300 bg-[#f5f5f4] px-2">
      <button type="button" aria-label="Toggle sidebar" title="Sidebar (F9)" className={tb()} onClick={onToggleSidebar}>
        <Icon d={ICONS.sidebar} />
      </button>
      <MenuBar menus={menus} />
      <input
        aria-label="Notebook title"
        key={title}
        defaultValue={title}
        onBlur={(e) => editor.rename(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="w-24 shrink truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-neutral-800 hover:border-neutral-300 hover:bg-white focus:border-blue-400 focus:bg-white focus:outline-none lg:w-40"
      />
      <Sep />
      <div role="toolbar" aria-label="Tools" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" aria-label={t.label} aria-pressed={tool === t.id} title={`${t.label} (${t.key})`} className={tb(tool === t.id)} onClick={() => editor.setTool(t.id)}>
            <Icon d={t.icon} />
          </button>
        ))}
        <Sep />
        <button type="button" aria-label="Undo" title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : "Undo (Ctrl+Z)"} disabled={!canUndo} className={tb()} onClick={() => editor.undo()}>
          <Icon d={ICONS.undo} />
        </button>
        <button type="button" aria-label="Redo" title={redoLabel ? `Redo ${redoLabel} (Ctrl+Y)` : "Redo (Ctrl+Y)"} disabled={!canRedo} className={tb()} onClick={() => editor.redo()}>
          <Icon d={ICONS.redo} />
        </button>
        <Sep />

        {(tool === "pen" || tool === "highlighter") && (
          <>
            <div role="radiogroup" aria-label="Color" className="flex shrink-0 items-center gap-1 px-1">
              {PALETTE.map(({ c, n }) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={s.color === c}
                  aria-label={n}
                  title={n}
                  onClick={() => editor.updateSettings({ color: c })}
                  className={`h-5 w-5 shrink-0 rounded-full border transition-transform hover:scale-110 ${s.color === c ? "ring-2 ring-blue-500 ring-offset-1" : "border-neutral-300"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <label className="relative h-5 w-5 shrink-0 cursor-pointer overflow-hidden rounded-full border border-neutral-300 bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]" title="Custom color">
                <input type="color" aria-label="Custom color" className="absolute inset-0 cursor-pointer opacity-0" value={s.color.slice(0, 7)} onChange={(e) => editor.updateSettings({ color: e.target.value })} />
              </label>
            </div>
            <Sep />
            <div role="radiogroup" aria-label="Width" className="flex shrink-0 items-center gap-0.5">
              {(Object.keys(widths) as (keyof typeof widths)[]).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={Math.abs(curWidth - widths[k]) < 1e-6} aria-label={`${k} width`} title={`${k[0].toUpperCase()}${k.slice(1)}`} className={tb(Math.abs(curWidth - widths[k]) < 1e-6)} onClick={() => setWidth(widths[k])}>
                  <span className="rounded-full bg-neutral-800" style={{ width: k === "fine" ? 3 : k === "medium" ? 6 : 10, height: k === "fine" ? 3 : k === "medium" ? 6 : 10 }} />
                </button>
              ))}
            </div>
            {tool === "pen" && (
              <select
                aria-label="Line style"
                className="ml-1 h-8 shrink-0 rounded-md border border-neutral-300 bg-white px-1 text-xs"
                value={s.lineStyle}
                onChange={(e) => editor.updateSettings({ lineStyle: e.target.value as LineStyle })}
              >
                <option value="plain">━ Plain</option>
                <option value="dash">╍ Dashed</option>
                <option value="dashdot">━·━ Dash-dot</option>
                <option value="dot">┈ Dotted</option>
              </select>
            )}
          </>
        )}

        {tool === "eraser" && (
          <>
            <div role="radiogroup" aria-label="Eraser type" className="flex shrink-0 items-center gap-0.5">
              {([["standard", "Standard"], ["whiteout", "Whiteout"], ["stroke", "Delete stroke"]] as [EraserMode, string][]).map(([m, l]) => (
                <button key={m} type="button" role="radio" aria-checked={s.eraserMode === m} className={tb(s.eraserMode === m)} onClick={() => editor.updateSettings({ eraserMode: m })}>
                  {l}
                </button>
              ))}
            </div>
            <Sep />
            <div role="radiogroup" aria-label="Eraser size" className="flex shrink-0 items-center gap-0.5">
              {(["fine", "medium", "thick"] as EraserSize[]).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={s.eraserSize === k} aria-label={`${k} eraser`} title={k} className={tb(s.eraserSize === k)} onClick={() => editor.updateSettings({ eraserSize: k })}>
                  <span className="rounded-full border border-neutral-600" style={{ width: k === "fine" ? 6 : k === "medium" ? 11 : 17, height: k === "fine" ? 6 : k === "medium" ? 11 : 17 }} />
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <button type="button" aria-label="Insert page after" title="Insert page after" className={tb()} onClick={() => editor.insertPage()}>
          <Icon d={ICONS.pageAdd} />
        </button>
        <span role="status" aria-live="polite" className={`hidden w-24 text-right text-[11px] md:block ${saveStatus === "error" ? "text-red-600" : "text-neutral-400"}`}>
          {saveText[saveStatus]}
        </span>
        <button type="button" id="app-menu-btn" aria-label="Menu" className={`${tb()} sm:hidden`} onClick={onOpenSheet}>
          <Icon d={ICONS.kebab} className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
