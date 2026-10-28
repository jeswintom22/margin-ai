"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "@/hooks/useSession";
import { useEditorUI } from "@/hooks/useEditor";
import type { Editor } from "@/lib/engine/Editor";
import type { ToolId } from "@/lib/engine/input";
import type { MenuSection } from "@/components/menu/menuModel";
import MobileSheet from "@/components/menu/MobileSheet";
import EditorToolbar from "./EditorToolbar";
import EditorSidebar from "./EditorSidebar";
import EditorStatusBar from "./EditorStatusBar";
import Workspace from "./Workspace";
import PageTemplateDialog from "./PageTemplateDialog";

const IMPORT_INPUT_ID = "v2-import-input";

function gotoPage(editor: Editor, i: number) {
  const pages = editor.doc.pages;
  const p = pages[Math.max(0, Math.min(pages.length - 1, i))];
  if (p) editor.setCurrentPage(p.id);
}

/**
 * Margin v2 editor shell (Xournal++ layout): menubar + toolbar, sidebar,
 * continuous page workspace, status bar.
 */
export default function EditorApp() {
  const session = useSession();
  const { editor } = session;
  const [sidebar, setSidebar] = useState(true);
  const [sheet, setSheet] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const openImport = () => (document.getElementById(IMPORT_INPUT_ID) as HTMLInputElement | null)?.click();

  const tool = useEditorUI(editor, (u) => u.tool);
  const layout = useEditorUI(editor, (u) => u.layout);
  const zoomMode = useEditorUI(editor, (u) => u.zoomMode);
  const pageIndex = useEditorUI(editor, (u) => u.pageIndex);
  const pageCount = useEditorUI(editor, (u) => u.pageCount);
  const canUndo = useEditorUI(editor, (u) => u.canUndo);
  const canRedo = useEditorUI(editor, (u) => u.canRedo);
  const s = useEditorUI(editor, (u) => u.settings);
  const input = useEditorUI(editor, (u) => u.input);

  // Phones start with the sidebar closed (it overlays the page there).
  useEffect(() => {
    if (window.matchMedia("(max-width: 639px)").matches) {
      const t = setTimeout(() => setSidebar(false), 0);
      return () => clearTimeout(t);
    }
  }, []);

  const importChosen = async (file: File) => {
    const r = await session.importFile(file);
    setNotice(r.ok ? { kind: "info", text: r.legacy ? "Imported notebook from the classic Margin AI format." : "Notebook imported." } : { kind: "error", text: r.error });
  };

  const closeSheet = useCallback(() => {
    setSheet(false);
    document.getElementById("app-menu-btn")?.focus();
  }, []);

  // ---- keyboard shortcuts (Xournal++-style) ----
  const spaceTool = useRef<ToolId | null>(null);
  useEffect(() => {
    const isField = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (isField(e.target) || document.querySelector("[aria-modal='true']")) return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && k === "z") { e.preventDefault(); editor.undo(); }
      else if (mod && (k === "y" || (e.shiftKey && k === "z"))) { e.preventDefault(); editor.redo(); }
      else if (mod && e.shiftKey && (k === "p" || k === "h" || k === "e")) { e.preventDefault(); editor.setTool(k === "p" ? "pen" : k === "h" ? "highlighter" : "eraser"); }
      else if (mod && (k === "=" || k === "+")) { e.preventDefault(); editor.zoomBy(1.2); }
      else if (mod && k === "-") { e.preventDefault(); editor.zoomBy(1 / 1.2); }
      else if (mod && k === "0") { e.preventDefault(); editor.setZoom("custom", 1); }
      else if (mod && k === "home") { e.preventDefault(); gotoPage(editor, 0); }
      else if (mod && k === "end") { e.preventDefault(); gotoPage(editor, editor.doc.pages.length - 1); }
      else if (k === "pagedown") { e.preventDefault(); gotoPage(editor, editor.ui.pageIndex + 1); }
      else if (k === "pageup") { e.preventDefault(); gotoPage(editor, editor.ui.pageIndex - 1); }
      else if (k === "f9") { e.preventDefault(); setSidebar((v) => !v); }
      else if (k === " " && !e.repeat && !mod) {
        e.preventDefault();
        if (editor.currentTool !== "hand") { spaceTool.current = editor.currentTool; editor.setTool("hand"); }
      } else if (!mod && !e.altKey) {
        if (k === "p") editor.setTool("pen");
        else if (k === "h") editor.setTool("highlighter");
        else if (k === "e") editor.setTool("eraser");
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " " && spaceTool.current) {
        editor.setTool(spaceTool.current);
        spaceTool.current = null;
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [editor]);

  const a = (id: string, label: string, onSelect: () => void, extra: { shortcut?: string; checked?: boolean; disabled?: boolean; danger?: boolean } = {}) =>
    ({ type: "action" as const, id, label, onSelect, ...extra });
  const d = (id: string) => ({ type: "divider" as const, id });
  const n = (id: string, label: string, text?: string) => ({ type: "note" as const, id, label, text });

  const menus: MenuSection[] = [
    {
      id: "file", label: "File", items: [
        a("new", "New notebook", () => void session.create("Untitled")),
        a("import", "Import notebook…", openImport),
        a("export", "Export notebook (.margin.json)", () => void session.exportFile()),
        d("f1"),
        a("delete", `Delete “${editor.doc.title}”`, () => {
          if (window.confirm(`Delete notebook "${editor.doc.title}"? This cannot be undone.`)) void session.remove(editor.doc.id);
        }, { danger: true }),
      ],
    },
    {
      id: "edit", label: "Edit", items: [
        a("undo", "Undo", () => editor.undo(), { shortcut: "Ctrl+Z", disabled: !canUndo }),
        a("redo", "Redo", () => editor.redo(), { shortcut: "Ctrl+Y", disabled: !canRedo }),
      ],
    },
    {
      id: "view", label: "View", items: [
        a("l-vert", "Continuous vertical", () => editor.setLayoutMode("vertical"), { checked: layout === "vertical" }),
        a("l-horz", "Continuous horizontal", () => editor.setLayoutMode("horizontal"), { checked: layout === "horizontal" }),
        a("l-dual", "Two pages", () => editor.setLayoutMode("dual"), { checked: layout === "dual" }),
        d("v1"),
        a("z-in", "Zoom in", () => editor.zoomBy(1.2), { shortcut: "Ctrl++" }),
        a("z-out", "Zoom out", () => editor.zoomBy(1 / 1.2), { shortcut: "Ctrl+-" }),
        a("z-100", "Zoom 100%", () => editor.setZoom("custom", 1), { shortcut: "Ctrl+0" }),
        a("z-fw", "Fit width", () => editor.setZoom("fitWidth"), { checked: zoomMode === "fitWidth" }),
        a("z-fp", "Fit page", () => editor.setZoom("fitPage"), { checked: zoomMode === "fitPage" }),
        d("v2"),
        a("sidebar", "Sidebar", () => setSidebar((v) => !v), { checked: sidebar, shortcut: "F9" }),
      ],
    },
    {
      id: "nav", label: "Navigation", items: [
        a("first", "First page", () => gotoPage(editor, 0), { shortcut: "Ctrl+Home", disabled: pageIndex === 0 }),
        a("prev", "Previous page", () => gotoPage(editor, pageIndex - 1), { shortcut: "PgUp", disabled: pageIndex === 0 }),
        a("next", "Next page", () => gotoPage(editor, pageIndex + 1), { shortcut: "PgDn", disabled: pageIndex >= pageCount - 1 }),
        a("last", "Last page", () => gotoPage(editor, pageCount - 1), { shortcut: "Ctrl+End", disabled: pageIndex >= pageCount - 1 }),
      ],
    },
    {
      id: "journal", label: "Journal", items: [
        a("tpl", "Page template…", () => setTemplateOpen(true)),
        d("j1"),
        a("ins-before", "Insert page before", () => editor.insertPage(editor.ui.currentPageId, "before")),
        a("ins-after", "Insert page after", () => editor.insertPage(editor.ui.currentPageId, "after")),
        a("dup", "Duplicate page", () => editor.duplicatePage()),
        a("up", "Move page up", () => editor.movePage(editor.ui.currentPageId, pageIndex - 1), { disabled: pageIndex === 0 }),
        a("down", "Move page down", () => editor.movePage(editor.ui.currentPageId, pageIndex + 1), { disabled: pageIndex >= pageCount - 1 }),
        a("del-page", "Delete page", () => editor.deletePage(), { disabled: pageCount <= 1 }),
      ],
    },
    {
      id: "tools", label: "Tools", items: [
        a("t-pen", "Pen", () => editor.setTool("pen"), { checked: tool === "pen", shortcut: "P" }),
        a("t-hl", "Highlighter", () => editor.setTool("highlighter"), { checked: tool === "highlighter", shortcut: "H" }),
        a("t-er", "Eraser", () => editor.setTool("eraser"), { checked: tool === "eraser", shortcut: "E" }),
        a("t-hand", "Hand", () => editor.setTool("hand"), { checked: tool === "hand", shortcut: "Space" }),
        d("t1"),
        a("pressure", "Pressure sensitivity", () => editor.updateSettings({ pressure: !s.pressure }), { checked: s.pressure }),
        a("touch-auto", "Touch: draw until a pen is used", () => editor.updateInput({ touchDrawing: "auto" }), { checked: input.touchDrawing === "auto" }),
        a("touch-on", "Touch: always draw", () => editor.updateInput({ touchDrawing: "on" }), { checked: input.touchDrawing === "on" }),
        a("touch-off", "Touch: scroll & zoom only", () => editor.updateInput({ touchDrawing: "off" }), { checked: input.touchDrawing === "off" }),
      ],
    },
    {
      id: "help", label: "Help", items: [
        n("h-tools", "Tools", "P pen · H highlighter · E eraser · hold Space to pan"),
        n("h-edit", "Edit", "Ctrl+Z undo · Ctrl+Y redo"),
        n("h-nav", "Pages", "PgUp/PgDn · Ctrl+Home/End · F9 sidebar"),
        n("h-zoom", "Zoom", "Ctrl+scroll or pinch · Ctrl+0 100%"),
        n("h-pen", "Stylus", "Eraser end erases · barrel button selects (from P2)"),
        d("h1"),
        n("h-about", "Margin v2 preview", "Xournal++-style editor. The classic app with the voice tutor stays at /."),
      ],
    },
  ];

  if (session.loading) {
    return <div className="flex h-dvh items-center justify-center text-sm text-neutral-500">Loading notebook…</div>;
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#d9d8d4]">
      <input
        id={IMPORT_INPUT_ID}
        type="file"
        accept=".json,application/json"
        aria-label="Import notebook file"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void importChosen(f);
        }}
      />
      <EditorToolbar editor={editor} menus={menus} saveStatus={session.saveStatus} onToggleSidebar={() => setSidebar((v) => !v)} onOpenSheet={() => setSheet(true)} />

      <div role="note" className="flex items-center justify-center gap-2 bg-blue-50 px-3 py-1 text-[11px] text-blue-900">
        Preview of the new Xournal++-style editor — notebooks here are separate from the classic app.
        <Link href="/" className="font-medium underline">Open classic app</Link>
      </div>
      {!session.storageAvailable && (
        <div role="alert" className="bg-amber-50 px-3 py-1.5 text-xs text-amber-800">Storage is unavailable — notes will not persist after you close this tab.</div>
      )}
      {session.conflict && (
        <div role="alert" className="flex items-center gap-2 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          This notebook was changed in another tab.
          <button type="button" className="rounded border border-amber-300 px-2 py-0.5 hover:bg-amber-100" onClick={() => void session.reloadFromStorage()}>Discard my changes &amp; reload</button>
        </div>
      )}
      {session.saveStatus === "error" && (
        <div role="alert" className="bg-red-50 px-3 py-1.5 text-xs text-red-700">Failed to save. Edits are kept in memory and retried — consider exporting a backup.</div>
      )}
      {notice && (
        <div role={notice.kind === "error" ? "alert" : "status"} className={`flex items-center justify-between gap-2 px-3 py-1.5 text-xs ${notice.kind === "error" ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}>
          {notice.text}
          <button type="button" aria-label="Dismiss" className="rounded px-1 hover:bg-black/5" onClick={() => setNotice(null)}>✕</button>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {sidebar && (
          <EditorSidebar
            editor={editor}
            assets={session.assets}
            metas={session.metas}
            onOpen={(id) => void session.open(id)}
            onCreate={(t) => void session.create(t)}
            onDelete={(id) => void session.remove(id)}
            onImport={openImport}
          />
        )}
        <main className="relative min-w-0 flex-1">
          <Workspace editor={editor} assets={session.assets} />
        </main>
        <MobileSheet menus={menus} open={sheet} onClose={closeSheet} />
      </div>
      <EditorStatusBar editor={editor} />
      {templateOpen && <PageTemplateDialog editor={editor} onClose={() => setTemplateOpen(false)} />}
    </div>
  );
}
