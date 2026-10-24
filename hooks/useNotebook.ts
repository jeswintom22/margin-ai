"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createNotebook,
  createPage,
  createStroke,
  userLayer,
  aiLayer,
  createLayer,
  newId,
  type EditorTool,
  type Notebook,
  type NotebookMeta,
  type NotebookPage,
  type PaperStyle,
  type Point,
  type Stroke,
  type StrokeTool,
  type PageElement,
} from "@/lib/document/types";
import { NotebookHistory, type PageOperation, apply, applyInsertion, removeStrokes, EraseTransaction } from "@/lib/history/history";
import type { ImportedPdfPage } from "@/lib/pdf/importPdf";
import { layoutAnswer, placeNearSelection, type Placement } from "@/lib/ai/answerLayout";
import { layoutCheckMarks, unionBounds } from "@/lib/ai/markLayout";
import { strokeBounds } from "@/lib/drawing/geometry";
import type { AnswerDocument } from "@/lib/ai/answerSchema";
import { strokeIntersectsRect, simplifyPoints, strokeInLasso, polygonBounds, type Rect } from "@/lib/drawing/geometry";
import * as db from "@/lib/storage/db";
import { AutoSaver } from "@/lib/storage/autosave";
import { downloadNotebook, importNotebookJSON } from "@/lib/storage/exportImport";

import type { SaveState as SaveStatus } from "@/lib/storage/autosave";
export type { SaveStatus };

const TAB_ID = newId();
const AUTOSAVE_MS = 800;
const CHANNEL = "margin-ai-tabs";

export function useNotebook() {
  const [metas, setMetas] = useState<NotebookMeta[]>([]);
  const [version, setVersion] = useState(0); // bumped on every doc mutation
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [tool, setTool] = useState<EditorTool>("pen");
  const [color, setColor] = useState("#1a1a1a");
  const [strokeWidth, setStrokeWidth] = useState(2.5);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [conflict, setConflict] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** Region the user selected (rect or lasso bounds) — used to crop captures. */
  const [selectionRect, setSelectionRect] = useState<Rect | null>(null);

  const [notebook, setNotebookState] = useState<Notebook | null>(null);
  const [histFlags, setHistFlags] = useState({ undo: false, redo: false });

  const nbRef = useRef<Notebook | null>(null);
  const history = useRef(new NotebookHistory());
  const eraseTxn = useRef<EraseTransaction | null>(null);
  const saverRef = useRef<AutoSaver | null>(null);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const setNotebook = useCallback((nb: Notebook | null) => {
    nbRef.current = nb;
    setNotebookState(nb);
  }, []);

  const page = useMemo<NotebookPage | null>(() => {
    if (!notebook) return null;
    return notebook.pages.find((p) => p.id === activePageId) ?? notebook.pages[0] ?? null;
  }, [notebook, activePageId]);

  /** Record a page-scoped op that has already been applied. */
  const recordPage = useCallback((pageId: string, op: PageOperation) => {
    history.current.record({ scope: "page", pageId, op });
  }, []);

  // ---------- persistence ----------

  // AutoSaver serializes saves, tracks dirty state across in-flight writes,
  // and retries failures. Created on mount; mutations only happen after mount.
  useEffect(() => {
    saverRef.current ??= new AutoSaver({
      delayMs: AUTOSAVE_MS,
      onStatus: setSaveStatus,
      save: async () => {
        const nb = nbRef.current;
        if (!nb) return;
        nb.updatedAt = Date.now();
        await db.saveNotebook(nb);
        await db.setLastOpened(nb.id);
        setMetas(await db.listNotebooks());
        try {
          const ch = new BroadcastChannel(CHANNEL);
          ch.postMessage({ type: "saved", id: nb.id, tab: TAB_ID, updatedAt: nb.updatedAt });
          ch.close();
        } catch { /* BroadcastChannel unsupported */ }
      },
    });
  }, []);

  const persist = useCallback(() => saverRef.current?.flush() ?? Promise.resolve(), []);

  const scheduleSave = useCallback(() => saverRef.current?.markDirty(), []);

  const refreshHistFlags = useCallback(() => {
    setHistFlags({ undo: history.current.canUndo, redo: history.current.canRedo });
  }, []);

  const mutate = useCallback(
    (fn: () => void) => {
      fn();
      setNotebookState(nbRef.current);
      refreshHistFlags();
      bump();
      scheduleSave();
    },
    [bump, scheduleSave, refreshHistFlags]
  );

  // Flush pending saves when the page is hidden or closed. pagehide and
  // visibilitychange fire earlier and more reliably than beforeunload on
  // mobile; none of them guarantee the async IndexedDB write completes.
  useEffect(() => {
    const flush = () => void persist();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [persist]);

  // multi-tab conflict notice
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e) => {
      const m = e.data;
      if (m?.type === "saved" && m.tab !== TAB_ID && nbRef.current?.id === m.id) {
        if (saverRef.current?.pending) setConflict(true);
      }
    };
    return () => ch.close();
  }, []);

  // ---------- initial load ----------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await db.listNotebooks();
        if (cancelled) return;
        setMetas(list);
        const lastId = await db.getLastOpened();
        let nb = (lastId && (await db.loadNotebook(lastId))) || null;
        if (!nb && list.length) nb = (await db.loadNotebook(list[0].id)) ?? null;
        if (!nb) {
          nb = createNotebook("My Notebook");
          await db.saveNotebook(nb);
          setMetas(await db.listNotebooks());
        }
        if (cancelled) return;
        setNotebook(nb);
        setActivePageId(nb.pages[0].id);
        setSaveStatus("saved");
      } catch {
        // Storage unavailable: run in-memory so the app still works.
        setStorageAvailable(false);
        const nb = createNotebook("My Notebook");
        setNotebook(nb);
        setActivePageId(nb.pages[0].id);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setNotebook]);

  // ---------- notebook ops ----------

  const openNotebook = useCallback(
    async (id: string) => {
      await persist();
      const nb = await db.loadNotebook(id);
      if (!nb) return;
      setNotebook(nb);
      history.current.clear();
      eraseTxn.current = null;
      setSelectedIds([]);
      setActivePageId(nb.pages[0].id);
      setSaveStatus("saved");
      setConflict(false);
      bump();
    },
    [persist, bump, setNotebook]
  );

  const addNotebook = useCallback(
    async (title: string) => {
      const nb = createNotebook(title || "Untitled");
      try {
        await db.saveNotebook(nb);
        setMetas(await db.listNotebooks());
      } catch {
        setStorageAvailable(false);
      }
      setNotebook(nb);
      history.current.clear();
      eraseTxn.current = null;
      setActivePageId(nb.pages[0].id);
      setSaveStatus("saved");
      bump();
    },
    [bump, setNotebook]
  );

  const renameNotebook = useCallback(
    (title: string) => {
      if (!nbRef.current || !title.trim()) return;
      mutate(() => {
        nbRef.current!.title = title.trim();
      });
    },
    [mutate]
  );

  const removeNotebook = useCallback(
    async (id: string) => {
      try {
        await db.deleteNotebook(id);
      } catch { /* ignore */ }
      const list = await db.listNotebooks().catch(() => [] as NotebookMeta[]);
      setMetas(list);
      if (nbRef.current?.id === id) {
        let nb = list.length ? ((await db.loadNotebook(list[0].id)) ?? null) : null;
        if (!nb) {
          nb = createNotebook("My Notebook");
          try {
            await db.saveNotebook(nb);
            setMetas(await db.listNotebooks());
          } catch { /* ignore */ }
        }
        setNotebook(nb);
        history.current.clear();
      eraseTxn.current = null;
        setActivePageId(nb.pages[0].id);
        bump();
      }
    },
    [bump, setNotebook]
  );

  // ---------- page ops ----------

  const addPage = useCallback(() => {
    const nb = nbRef.current;
    if (!nb) return;
    const p = createPage(`Page ${nb.pages.length + 1}`, page?.paperStyle ?? "ruled");
    mutate(() => {
      nb.pages.push(p);
    });
    setActivePageId(p.id);
    setSelectedIds([]);
  }, [mutate, page]);

  /** Append imported PDF pages (locked backgrounds) after the current page. */
  const importPdfPages = useCallback(
    (imported: ImportedPdfPage[]) => {
      const nb = nbRef.current;
      if (!nb || !imported.length) return;
      const at = page ? nb.pages.indexOf(page) + 1 : nb.pages.length;
      const created = imported.map((ip) => ({ ...createPage(ip.title, "blank"), width: ip.width, height: ip.height, background: ip.background }));
      mutate(() => {
        nb.pages.splice(at, 0, ...created);
      });
      setActivePageId(created[0].id);
      setSelectedIds([]);
    },
    [mutate, page]
  );

  const renamePage = useCallback(
    (pageId: string, title: string) => {
      mutate(() => {
        const p = nbRef.current?.pages.find((x) => x.id === pageId);
        if (p) p.title = title;
      });
    },
    [mutate]
  );

  const deletePage = useCallback(
    (pageId: string) => {
      const nb = nbRef.current;
      if (!nb || nb.pages.length <= 1) return;
      const idx = nb.pages.findIndex((p) => p.id === pageId);
      mutate(() => {
        nb.pages = nb.pages.filter((p) => p.id !== pageId);
      });
      history.current.prunePage(pageId);
      if (activePageId === pageId) {
        setActivePageId(nb.pages[Math.max(0, idx - 1)]?.id ?? nb.pages[0].id);
      }
    },
    [activePageId, mutate]
  );

  const movePage = useCallback(
    (pageId: string, dir: -1 | 1) => {
      const nb = nbRef.current;
      if (!nb) return;
      const i = nb.pages.findIndex((p) => p.id === pageId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= nb.pages.length) return;
      mutate(() => {
        [nb.pages[i], nb.pages[j]] = [nb.pages[j], nb.pages[i]];
      });
    },
    [mutate]
  );

  const selectPage = useCallback((pageId: string) => {
    setActivePageId(pageId);
    setSelectedIds([]);
  }, []);

  const setPaperStyle = useCallback(
    (style: PaperStyle) => {
      if (!page) return;
      mutate(() => {
        page.paperStyle = style;
      });
    },
    [mutate, page]
  );

  // ---------- stroke ops ----------

  const commitStroke = useCallback(
    (points: Point[]) => {
      const nb = nbRef.current;
      if (!nb || !page || points.length === 0 || tool === "eraser" || tool === "select" || tool === "lasso") return;
      const pts = simplifyPoints(points, 0.4);
      const stroke = createStroke(pts, {
        color,
        width: tool === "highlighter" ? strokeWidth * 4 : strokeWidth,
        tool: tool as StrokeTool,
      });
      mutate(() => {
        const layer = userLayer(page);
        apply(page, { type: "addStroke", layerId: layer.id, stroke });
        recordPage(page.id, { type: "addStroke", layerId: layer.id, stroke });
      });
    },
    [page, tool, color, strokeWidth, mutate, recordPage]
  );

  // ---------- eraser gestures ----------

  /** Begin one continuous eraser drag. Ends via endErase or a new beginErase. */
  const beginErase = useCallback(() => {
    eraseTxn.current = page ? new EraseTransaction(page.id) : null;
  }, [page]);

  /**
   * Erase strokes near a point. Inside a gesture (after beginErase) hits are
   * accumulated into the transaction; standalone calls erase as a single op
   * so eraseAt is safe to use without a gesture lifecycle.
   */
  const eraseAt = useCallback(
    (x: number, y: number, radius: number) => {
      if (!page) return false;
      const txn = eraseTxn.current ?? new EraseTransaction(page.id);
      const removed = txn.eraseAt(page, x, y, radius);
      if (removed === 0) return false;
      if (eraseTxn.current) {
        // Mid-gesture: the doc is mutated; the canvas repaints itself, and the
        // save + React sync happen when the gesture commits in endErase.
        scheduleSave();
        return true;
      }
      const op = txn.commit(page);
      if (!op) return false;
      mutate(() => {
        recordPage(page.id, op);
      });
      return true;
    },
    [page, mutate, recordPage, scheduleSave]
  );

  /** Commit the current eraser gesture as one undoable operation. */
  const endErase = useCallback(() => {
    const txn = eraseTxn.current;
    eraseTxn.current = null;
    if (!txn || !page) return;
    const op = txn.commit(page);
    if (!op) return;
    mutate(() => {
      recordPage(page.id, op);
    });
  }, [page, mutate, recordPage]);

  const selectInRect = useCallback(
    (rect: Rect): string[] => {
      if (!page) return [];
      const ids: string[] = [];
      for (const layer of page.layers) {
        for (const s of layer.strokes) {
          if (strokeIntersectsRect(s, rect)) ids.push(s.id);
        }
      }
      setSelectedIds(ids);
      setSelectionRect(ids.length ? rect : null);
      return ids;
    },
    [page]
  );

  /** Lasso selection: strokes inside (or crossing into) the closed loop. */
  const selectInLasso = useCallback(
    (poly: Point[]): string[] => {
      if (!page) return [];
      const ids = page.layers.flatMap((l) => l.strokes).filter((s) => strokeInLasso(s, poly)).map((s) => s.id);
      setSelectedIds(ids);
      setSelectionRect(ids.length ? polygonBounds(poly) : null);
      return ids;
    },
    [page]
  );

  const deleteSelected = useCallback(() => {
    if (!page || selectedIds.length === 0) return;
    const wanted = new Set(selectedIds);
    mutate(() => {
      const removed = removeStrokes(page, wanted);
      const eraserOp = { id: newId(), targetStrokeIds: removed.map((r) => r.stroke.id), at: Date.now() };
      page.eraserOperations.push(eraserOp);
      recordPage(page.id, { type: "eraseStrokes", eraserOp, removed });
    });
    setSelectedIds([]);
  }, [page, selectedIds, mutate, recordPage]);

  // ---------- undo/redo ----------

  // Refresh undo/redo availability whenever the active page changes.
  useEffect(() => {
    refreshHistFlags();
  }, [refreshHistFlags]);

  const canUndo = histFlags.undo;
  const canRedo = histFlags.redo;

  /** Undo the most recent edit anywhere in the notebook and show its page. */
  const undo = useCallback(() => {
    const nb = nbRef.current;
    if (!nb) return;
    let focus: string | null = null;
    mutate(() => {
      focus = history.current.undo(nb);
    });
    if (focus) setActivePageId(focus);
    setSelectedIds([]);
  }, [mutate]);

  const redo = useCallback(() => {
    const nb = nbRef.current;
    if (!nb) return;
    let focus: string | null = null;
    mutate(() => {
      focus = history.current.redo(nb);
    });
    if (focus) setActivePageId(focus);
    setSelectedIds([]);
  }, [mutate]);

  // ---------- AI insertion ----------

  /**
   * Lay out a structured answer and insert it below existing content on the
   * current page, creating continuation pages as needed. One undoable op
   * (recorded on the starting page's history). Returns the first page id and
   * how many pages the answer spans.
   */
  const insertAnswer = useCallback(
    (
      doc: AnswerDocument,
      near?: string[]
    ): { ok: boolean; error?: string; pageId?: string; pageSpan?: number; groupId?: string; placement?: Placement } => {
      const nb = nbRef.current;
      if (!nb || !page) return { ok: false, error: "No page is open" };
      if (!doc.blocks.length) return { ok: false, error: "The answer is empty" };
      try {
        const ai = aiLayer(page);
        const bottom = (e: PageElement) =>
          e.type === "rect" ? e.y + e.h : e.type === "line" ? Math.max(e.y1, e.y2) : e.y;
        // Bottom of everything already on the page — AI answers *and* the
        // user's ink — so new answers never overlap either.
        const inkBottom = userLayer(page).strokes.map((s) => strokeBounds(s).maxY);
        const maxY = Math.max(0, ...ai.elements.map(bottom), ...inkBottom);
        const flowOpts = { pageWidth: page.width, pageHeight: page.height, startY: maxY || undefined };
        const nearStrokes = near?.length ? page.layers.flatMap((l) => l.strokes).filter((s) => near.includes(s.id)) : [];
        const { pages: laidOut, groupId, placement } = nearStrokes.length
          ? placeNearSelection(doc, unionBounds(nearStrokes.map(strokeBounds)), flowOpts)
          : { ...layoutAnswer(doc, flowOpts), placement: "flow" as const };
        const startIdx = nb.pages.indexOf(page);
        const appends: { pageId: string; layerId: string; elements: PageElement[] }[] = [
          { pageId: page.id, layerId: ai.id, elements: laidOut[0] },
        ];
        const createdPages: { page: NotebookPage; index: number }[] = [];
        for (let i = 1; i < laidOut.length; i++) {
          const p = createPage(`Page ${nb.pages.length + i}`);
          const l = createLayer("AI", "ai");
          p.layers.push(l);
          createdPages.push({ page: p, index: startIdx + i });
          appends.push({ pageId: p.id, layerId: l.id, elements: laidOut[i] });
        }
        const op = { type: "insertElements" as const, groupId, createdPages, appends };
        mutate(() => {
          applyInsertion(nb, op);
          history.current.record({ scope: "notebook", op });
        });
        setActivePageId(page.id);
        return { ok: true, pageId: page.id, pageSpan: laidOut.length, groupId, placement };
      } catch {
        return { ok: false, error: "Could not lay out the answer" };
      }
    },
    [page, mutate]
  );

  /** Write check marks beside the selected lines (one undoable insertion). */
  const insertCheckMarks = useCallback(
    (check: Extract<AnswerDocument["blocks"][number], { type: "check" }>, strokeIds: string[], lineCount: number) => {
      const nb = nbRef.current;
      if (!nb || !page) return null;
      const strokes = page.layers.flatMap((l) => l.strokes).filter((s) => strokeIds.includes(s.id));
      const groupId = newId();
      const elements = layoutCheckMarks(check, strokes, groupId, lineCount, page.width);
      if (!elements.length) return null;
      const ai = aiLayer(page);
      const op = { type: "insertElements" as const, groupId, createdPages: [], appends: [{ pageId: page.id, layerId: ai.id, elements }] };
      mutate(() => {
        applyInsertion(nb, op);
        history.current.record({ scope: "notebook", op });
      });
      return groupId;
    },
    [page, mutate]
  );

  /** Remove one AI answer/mark group everywhere ("Undo AI answer"); undoable per page. */
  const removeAIGroup = useCallback(
    (groupId: string) => {
      const nb = nbRef.current;
      if (!nb) return false;
      let removedAny = false;
      mutate(() => {
        for (const p of nb.pages) {
          for (const layer of p.layers) {
            const removed = layer.elements.map((element, index) => ({ index, element })).filter((r) => r.element.groupId === groupId);
            if (!removed.length) continue;
            layer.elements = layer.elements.filter((e) => e.groupId !== groupId);
            recordPage(p.id, { type: "removeElements", pageId: p.id, layerId: layer.id, removed });
            removedAny = true;
          }
        }
      });
      return removedAny;
    },
    [mutate, recordPage]
  );

  /** Remove all AI elements on the current page (one undoable op). */
  const clearAIContent = useCallback(() => {
    if (!page) return;
    const layer = page.layers.find((l) => l.author === "ai");
    if (!layer || layer.elements.length === 0) return;
    mutate(() => {
      const removed = layer.elements.map((element, index) => ({ index, element }));
      layer.elements = [];
      recordPage(page.id, { type: "removeElements", pageId: page.id, layerId: layer.id, removed });
    });
  }, [page, mutate, recordPage]);

  // ---------- AI-readiness ops (no UI yet) ----------

  /** Insert authored strokes into the AI layer at document coordinates. */
  const insertAIStrokes = useCallback(
    (strokes: Stroke[]) => {
      if (!page) return;
      mutate(() => {
        const layer = aiLayer(page);
        for (const stroke of strokes) {
          apply(page, { type: "addStroke", layerId: layer.id, stroke });
          recordPage(page.id, { type: "addStroke", layerId: layer.id, stroke });
        }
      });
    },
    [page, mutate, recordPage]
  );

  const setAILayerVisible = useCallback(
    (visible: boolean) => {
      if (!page) return;
      const l = page.layers.find((x) => x.author === "ai");
      if (!l || l.visible === visible) return; // no-op: no history entry
      mutate(() => {
        l.visible = visible;
        recordPage(page.id, { type: "setLayerVisibility", layerId: l.id, from: !visible, to: visible });
      });
    },
    [page, mutate, recordPage]
  );

  // ---------- export / import ----------

  const exportNotebook = useCallback(() => {
    if (nbRef.current) downloadNotebook(nbRef.current);
  }, []);

  const importNotebook = useCallback(
    async (text: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const nb = importNotebookJSON(text);
        await db.saveNotebook(nb);
        setMetas(await db.listNotebooks());
        setNotebook(nb);
        history.current.clear();
      eraseTxn.current = null;
        setActivePageId(nb.pages[0].id);
        bump();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Import failed" };
      }
    },
    [bump, setNotebook]
  );

  const reloadFromStorage = useCallback(async () => {
    const nb = nbRef.current;
    if (!nb) return;
    saverRef.current?.cancelPending();
    const fresh = await db.loadNotebook(nb.id);
    if (fresh) {
      setNotebook(fresh);
      history.current.clear();
      eraseTxn.current = null;
      setActivePageId((id) => (fresh.pages.some((p) => p.id === id) ? id : fresh.pages[0].id));
      setConflict(false);
      bump();
    }
  }, [bump, setNotebook]);

  return {
    loading,
    notebook,
    metas,
    page,
    activePageId,
    version,
    tool, setTool,
    color, setColor,
    strokeWidth, setStrokeWidth,
    saveStatus,
    storageAvailable,
    conflict, setConflict,
    selectedIds, setSelectedIds, selectionRect, selectInLasso, importPdfPages,
    canUndo, canRedo,
    openNotebook, addNotebook, renameNotebook, removeNotebook,
    addPage, renamePage, deletePage, movePage, selectPage, setPaperStyle,
    commitStroke, beginErase, eraseAt, endErase, selectInRect, deleteSelected,
    undo, redo,
    insertAIStrokes, setAILayerVisible, insertAnswer, clearAIContent, insertCheckMarks, removeAIGroup,
    exportNotebook, importNotebook, reloadFromStorage,
  };
}

export type NotebookStore = ReturnType<typeof useNotebook>;
