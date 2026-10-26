"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNotebook } from "@/hooks/useNotebook";
import { useVoiceAssistant } from "@/hooks/useVoiceAssistant";
import Toolbar from "@/components/notebook/Toolbar";
import Sidebar from "@/components/notebook/Sidebar";
import PaperCanvas, { type PaperCanvasApi } from "@/components/canvas/PaperCanvas";
import VoiceDock from "@/components/notebook/VoiceDock";
import StatusBar from "@/components/notebook/StatusBar";
import MobileSheet from "@/components/menu/MobileSheet";
import type { MenuSection } from "@/components/menu/menuModel";
import { buildNotebookContext } from "@/lib/ai/contextBuilder";
import { captureRegionPNG } from "@/lib/drawing/capture";
import { readPdfFile, pdfToPages, PdfImportError } from "@/lib/pdf/importPdf";

export default function NotebookApp() {
  const nb = useNotebook();
  const voice = useVoiceAssistant(nb, {
    capture: () => {
      if (!nb.page) return null;
      if (nb.selectedIds.length) {
        return captureRegionPNG(nb.page, nb.selectedIds, { rect: nb.selectionRect ?? undefined });
      }
      // Nothing selected: send the whole page — ink and any PDF background —
      // so the assistant can always see what the user is asking about.
      return captureRegionPNG(nb.page, [], { rect: { x: 0, y: 0, w: nb.page.width, h: nb.page.height } });
    },
    getContext: () =>
      nb.notebook && nb.page
        ? buildNotebookContext(nb.notebook, { pageId: nb.page.id, selectedStrokeIds: nb.selectedIds })
        : null,
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const voiceToggle = useRef(voice.toggle);
  useEffect(() => {
    voiceToggle.current = voice.toggle;
  }, [voice.toggle]);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const canvasApi = useRef<PaperCanvasApi | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const importPdf = async (file: File) => {
    setPdfBusy(true);
    setImportError(null);
    try {
      const data = await readPdfFile(file);
      nb.importPdfPages(await pdfToPages(data, { name: file.name.replace(/\.pdf$/i, "") }));
    } catch (e) {
      setImportError(e instanceof PdfImportError ? e.message : "The PDF could not be imported.");
    } finally {
      setPdfBusy(false);
    }
  };
  const importNotebookJson = async (file: File) => {
    const res = await nb.importNotebook(await file.text());
    if (!res.ok) setImportError(res.error ?? "The notebook could not be imported.");
  };
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    document.getElementById("app-menu-btn")?.focus();
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        nb.undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        nb.redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (nb.selectedIds.length) {
          e.preventDefault();
          nb.deleteSelected();
        }
      } else if (e.key === "Escape") {
        nb.setSelectedIds([]);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "m") {
        e.preventDefault();
        voiceToggle.current();
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "p") nb.setTool("pen");
        else if (k === "h") nb.setTool("highlighter");
        else if (k === "e") nb.setTool("eraser");
        else if (k === "s") nb.setTool("select");
        else if (k === "l") nb.setTool("lasso");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nb]);

  const closeSidebarOnMobile = useCallback(() => {
    if (window.innerWidth < 640) setSidebarOpen(false);
  }, []);

  if (nb.loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-neutral-500">
        Loading notebook…
      </div>
    );
  }

  const aiLayerOnPage = nb.page?.layers.find((l) => l.author === "ai");
  const aiCount = aiLayerOnPage?.elements.length ?? 0;
  const aiVisible = aiLayerOnPage?.visible ?? true;
  const paperStyle = nb.page?.paperStyle ?? "ruled";

  // One item tree feeds the desktop menubar and the mobile bottom sheet.
  const menus: MenuSection[] = [
    {
      id: "file",
      label: "File",
      items: [
        { type: "action", id: "new-notebook", label: "New notebook", onSelect: () => void nb.addNotebook("Untitled") },
        { type: "action", id: "new-page", label: "New page", onSelect: nb.addPage },
        { type: "divider", id: "f-d1" },
        { type: "action", id: "import-pdf", label: pdfBusy ? "Importing PDF…" : "Import PDF…", disabled: pdfBusy, onSelect: () => pdfInputRef.current?.click() },
        { type: "action", id: "import-json", label: "Import notebook (.json)…", onSelect: () => jsonInputRef.current?.click() },
        { type: "action", id: "export", label: "Export notebook (.json)", onSelect: nb.exportNotebook },
        { type: "divider", id: "f-d2" },
        {
          type: "action",
          id: "del-notebook",
          label: `Delete “${nb.notebook?.title ?? "notebook"}”`,
          danger: true,
          onSelect: () => {
            const nbk = nb.notebook;
            if (nbk && window.confirm(`Delete notebook "${nbk.title}"? This cannot be undone.`)) void nb.removeNotebook(nbk.id);
          },
        },
      ],
    },
    {
      id: "view",
      label: "View",
      items: [
        { type: "action", id: "sidebar", label: "Sidebar", checked: sidebarOpen, onSelect: () => setSidebarOpen((o) => !o) },
        { type: "divider", id: "v-d1" },
        { type: "action", id: "paper-blank", label: "Blank paper", checked: paperStyle === "blank", onSelect: () => nb.setPaperStyle("blank") },
        { type: "action", id: "paper-ruled", label: "Ruled paper", checked: paperStyle === "ruled", onSelect: () => nb.setPaperStyle("ruled") },
        { type: "action", id: "paper-grid", label: "Grid paper", checked: paperStyle === "grid", onSelect: () => nb.setPaperStyle("grid") },
        { type: "divider", id: "v-d2" },
        { type: "action", id: "zoom-in", label: "Zoom in", shortcut: "Ctrl+scroll", onSelect: () => canvasApi.current?.zoomIn() },
        { type: "action", id: "zoom-out", label: "Zoom out", onSelect: () => canvasApi.current?.zoomOut() },
        { type: "action", id: "zoom-fit", label: "Fit page width", onSelect: () => canvasApi.current?.zoomFit() },
        { type: "divider", id: "v-d3" },
        { type: "action", id: "ai-visible", label: "Show AI layer", checked: aiVisible, disabled: aiCount === 0, onSelect: () => nb.setAILayerVisible(!aiVisible) },
        { type: "action", id: "ai-clear", label: "Clear AI content on this page", disabled: aiCount === 0, onSelect: nb.clearAIContent },
      ],
    },
    {
      id: "settings",
      label: "Settings",
      items: [
        { type: "action", id: "voice", label: "Voice assistant", shortcut: "Ctrl+M", checked: voice.on, disabled: !voice.supported.recognition, onSelect: voice.toggle },
        ...(voice.supported.recognition
          ? []
          : [{ type: "note" as const, id: "voice-unsupported", label: "Voice needs Chrome or Edge" }]),
        { type: "divider", id: "s-d1" },
        { type: "note", id: "storage", label: "Local storage", text: nb.storageAvailable ? "On — notes stay on this device" : "Unavailable — export a backup" },
      ],
    },
    {
      id: "help",
      label: "Help",
      items: [
        { type: "note", id: "h-tools", label: "Tools", text: "P pen · H highlighter · E eraser · S select · L lasso" },
        { type: "note", id: "h-edit", label: "Edit", text: "Ctrl+Z undo · Ctrl+Y redo · Del delete · Esc deselect" },
        { type: "note", id: "h-view", label: "View", text: "Ctrl+scroll zoom · Ctrl+M voice" },
        { type: "divider", id: "h-d1" },
        { type: "note", id: "h-say", label: "Say", text: "“check my work” · “finish this” · “hint” · “graph this” · “explain this” · “undo” · “new page”" },
        { type: "divider", id: "h-d2" },
        { type: "note", id: "h-about", label: "Margin AI", text: "A handwriting notebook with a voice math tutor" },
      ],
    },
  ];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      {/* Hidden pickers backing the File menu (kept at app level so they
          exist regardless of which menu view is showing). */}
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        aria-label="Import PDF"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void importPdf(f);
        }}
      />
      <input
        ref={jsonInputRef}
        type="file"
        accept=".json"
        aria-label="Import notebook (.json)"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void importNotebookJson(f);
        }}
      />
      <Toolbar
        title={nb.notebook?.title ?? ""}
        tool={nb.tool}
        color={nb.color}
        strokeWidth={nb.strokeWidth}
        canUndo={nb.canUndo}
        canRedo={nb.canRedo}
        saveStatus={nb.saveStatus}
        sidebarOpen={sidebarOpen}
        menus={menus}
        onOpenAppMenu={() => setMenuOpen(true)}
        onRename={nb.renameNotebook}
        onTool={nb.setTool}
        onColor={nb.setColor}
        onWidth={nb.setStrokeWidth}
        onUndo={nb.undo}
        onRedo={nb.redo}
        onAddPage={nb.addPage}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
      />

      {!nb.storageAvailable && (
        <div role="alert" className="bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          Local storage is unavailable — notes will not persist after you close this tab.
        </div>
      )}
      {nb.conflict && (
        <div role="alert" className="flex items-center gap-2 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          This notebook was modified in another tab. Your unsaved changes may conflict.
          <button
            type="button"
            className="rounded border border-amber-300 px-2 py-0.5 hover:bg-amber-100"
            onClick={nb.reloadFromStorage}
          >
            Discard my changes &amp; reload
          </button>
        </div>
      )}
      {nb.saveStatus === "error" && (
        <div role="alert" className="bg-red-50 px-3 py-1.5 text-xs text-red-700">
          Failed to save. Your latest edits are kept in memory and will be retried — consider exporting a backup.
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <Sidebar
          open={sidebarOpen}
          metas={nb.metas}
          activeNotebookId={nb.notebook?.id ?? null}
          pages={nb.notebook?.pages ?? []}
          activePageId={nb.page?.id ?? null}
          onOpenNotebook={(id) => {
            nb.openNotebook(id);
            closeSidebarOnMobile();
          }}
          onAddNotebook={nb.addNotebook}
          onDeleteNotebook={nb.removeNotebook}
          onImport={nb.importNotebook}
          onSelectPage={(id) => {
            nb.selectPage(id);
            closeSidebarOnMobile();
          }}
          onAddPage={nb.addPage}
          onRenamePage={nb.renamePage}
          onDeletePage={nb.deletePage}
          onMovePage={nb.movePage}
        />

        <main className="relative min-w-0 flex-1">
          {importError && (
            <div role="alert" className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800 shadow-sm">
              {importError}
              <button type="button" aria-label="Dismiss" onClick={() => setImportError(null)} className="rounded px-1 hover:bg-red-100">✕</button>
            </div>
          )}
          {voice.state === "thinking" && (
            <div role="status" className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-neutral-200 bg-white/95 px-3 py-1 text-xs text-neutral-600 shadow-sm">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" aria-hidden />
              Thinking…
            </div>
          )}
          {nb.page ? (
            <PaperCanvas
              key={nb.page.id}
              page={nb.page}
              tool={nb.tool}
              color={nb.color}
              strokeWidth={nb.strokeWidth}
              version={nb.version}
              selectedIds={nb.selectedIds}
              onCommitStroke={nb.commitStroke}
              onEraseBegin={nb.beginErase}
              onEraseAt={nb.eraseAt}
              onEraseEnd={nb.endErase}
              onSelectRect={nb.selectInRect}
              onSelectLasso={nb.selectInLasso}
              apiRef={canvasApi}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-neutral-400">
              No page selected
            </div>
          )}
        </main>

        <VoiceDock
          supported={voice.supported}
          on={voice.on}
          state={voice.state}
          heard={voice.heard}
          toast={voice.toast}
          toggle={voice.toggle}
        />
        <MobileSheet menus={menus} open={menuOpen} onClose={closeMenu} />
      </div>

      {nb.selectedIds.length > 0 && (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-neutral-200 bg-white/95 px-4 py-1.5 text-xs text-neutral-600 shadow-md backdrop-blur-sm">
          <span>{nb.selectedIds.length} stroke{nb.selectedIds.length > 1 ? "s" : ""} selected — say a command or:</span>
          <button
            type="button"
            onClick={nb.deleteSelected}
            className="rounded-full bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => nb.setSelectedIds([])}
            className="rounded-full px-2 py-1 hover:bg-neutral-100"
          >
            Clear
          </button>
        </div>
      )}

      <StatusBar
        tool={nb.tool}
        pageIndex={nb.notebook && nb.page ? Math.max(0, nb.notebook.pages.findIndex((x) => x.id === nb.page!.id)) : 0}
        pageCount={nb.notebook?.pages.length ?? 0}
        userStrokes={nb.page?.layers.filter((l) => l.author === "user").reduce((n, l) => n + l.strokes.length, 0) ?? 0}
        aiElements={aiLayerOnPage?.elements.length ?? 0}
        selected={nb.selectedIds.length}
        voiceOn={voice.on}
      />
    </div>
  );
}
