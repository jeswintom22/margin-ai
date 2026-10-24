"use client";

import { useCallback, useEffect, useState } from "react";
import { useNotebook } from "@/hooks/useNotebook";
import Toolbar from "@/components/notebook/Toolbar";
import Sidebar from "@/components/notebook/Sidebar";
import PaperCanvas from "@/components/canvas/PaperCanvas";
import AssistantPanel from "@/components/notebook/AssistantPanel";
import { buildNotebookContext } from "@/lib/ai/contextBuilder";
import { captureRegionPNG } from "@/lib/drawing/capture";

export default function NotebookApp() {
  const nb = useNotebook();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [assistantOpen, setAssistantOpen] = useState(false);

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
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "p") nb.setTool("pen");
        else if (k === "h") nb.setTool("highlighter");
        else if (k === "e") nb.setTool("eraser");
        else if (k === "s") nb.setTool("select");
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

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      <Toolbar
        title={nb.notebook?.title ?? ""}
        tool={nb.tool}
        color={nb.color}
        strokeWidth={nb.strokeWidth}
        paperStyle={nb.page?.paperStyle ?? "ruled"}
        canUndo={nb.canUndo}
        canRedo={nb.canRedo}
        saveStatus={nb.saveStatus}
        sidebarOpen={sidebarOpen}
        onRename={nb.renameNotebook}
        onTool={nb.setTool}
        onColor={nb.setColor}
        onWidth={nb.setStrokeWidth}
        onPaperStyle={nb.setPaperStyle}
        onUndo={nb.undo}
        onRedo={nb.redo}
        onAddPage={nb.addPage}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        onExport={nb.exportNotebook}
        assistantOpen={assistantOpen}
        onToggleAssistant={() => setAssistantOpen((o) => !o)}
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

        <main className="min-w-0 flex-1">
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
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-neutral-400">
              No page selected
            </div>
          )}
        </main>

        {assistantOpen && (
          <AssistantPanel
            onClose={() => setAssistantOpen(false)}
            onInsert={(doc) => nb.insertAnswer(doc)}
            getContext={() =>
              nb.notebook && nb.page
                ? buildNotebookContext(nb.notebook, { pageId: nb.page.id, selectedStrokeIds: nb.selectedIds })
                : null
            }
            hasSelection={nb.selectedIds.length > 0}
            captureSelection={() => (nb.page ? captureRegionPNG(nb.page, nb.selectedIds) : null)}
          />
        )}
      </div>

      {nb.selectedIds.length > 0 && (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm shadow-lg">
          <span>{nb.selectedIds.length} stroke{nb.selectedIds.length > 1 ? "s" : ""} selected</span>
          <button
            type="button"
            onClick={nb.deleteSelected}
            className="rounded-md bg-red-600 px-2.5 py-1 text-xs text-white hover:bg-red-700"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => nb.setSelectedIds([])}
            className="rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
