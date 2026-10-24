"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createNotebook,
  createPage,
  createStroke,
  userLayer,
  aiLayer,
  newId,
  type EditorTool,
  type Notebook,
  type NotebookMeta,
  type NotebookPage,
  type PaperStyle,
  type Point,
  type Stroke,
  type StrokeTool,
} from "@/lib/document/types";
import { PageHistory, apply, removeStrokes, EraseTransaction } from "@/lib/history/history";
import { strokeIntersectsRect, simplifyPoints, type Rect } from "@/lib/drawing/geometry";
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

  const [notebook, setNotebookState] = useState<Notebook | null>(null);
  const [histFlags, setHistFlags] = useState({ undo: false, redo: false });

  const nbRef = useRef<Notebook | null>(null);
  const histories = useRef(new Map<string, PageHistory>());
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

  const historyOf = useCallback((pageId: string) => {
    let h = histories.current.get(pageId);
    if (!h) {
      h = new PageHistory();
      histories.current.set(pageId, h);
    }
    return h;
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
    const nb = nbRef.current;
    const p = nb?.pages.find((x) => x.id === activePageId) ?? nb?.pages[0];
    const h = p ? histories.current.get(p.id) : undefined;
    setHistFlags({ undo: !!h?.canUndo, redo: !!h?.canRedo });
  }, [activePageId]);

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
      histories.current.clear();
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
      histories.current.clear();
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
        histories.current.clear();
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
      histories.current.delete(pageId);
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
      if (!nb || !page || points.length === 0 || tool === "eraser" || tool === "select") return;
      const pts = simplifyPoints(points, 0.4);
      const stroke = createStroke(pts, {
        color,
        width: tool === "highlighter" ? strokeWidth * 4 : strokeWidth,
        tool: tool as StrokeTool,
      });
      mutate(() => {
        const layer = userLayer(page);
        apply(page, { type: "addStroke", layerId: layer.id, stroke });
        historyOf(page.id).record({ type: "addStroke", layerId: layer.id, stroke });
      });
    },
    [page, tool, color, strokeWidth, mutate, historyOf]
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
        historyOf(page.id).record(op);
      });
      return true;
    },
    [page, mutate, historyOf, scheduleSave]
  );

  /** Commit the current eraser gesture as one undoable operation. */
  const endErase = useCallback(() => {
    const txn = eraseTxn.current;
    eraseTxn.current = null;
    if (!txn || !page) return;
    const op = txn.commit(page);
    if (!op) return;
    mutate(() => {
      historyOf(page.id).record(op);
    });
  }, [page, mutate, historyOf]);

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
      historyOf(page.id).record({ type: "eraseStrokes", eraserOp, removed });
    });
    setSelectedIds([]);
  }, [page, selectedIds, mutate, historyOf]);

  // ---------- undo/redo ----------

  // Refresh undo/redo availability whenever the active page changes.
  useEffect(() => {
    refreshHistFlags();
  }, [refreshHistFlags]);

  const canUndo = histFlags.undo;
  const canRedo = histFlags.redo;

  const undo = useCallback(() => {
    if (!page) return;
    mutate(() => {
      historyOf(page.id).undo(page);
    });
    setSelectedIds([]);
  }, [page, mutate, historyOf]);

  const redo = useCallback(() => {
    if (!page) return;
    mutate(() => {
      historyOf(page.id).redo(page);
    });
    setSelectedIds([]);
  }, [page, mutate, historyOf]);

  // ---------- AI-readiness ops (no UI yet) ----------

  /** Insert authored strokes into the AI layer at document coordinates. */
  const insertAIStrokes = useCallback(
    (strokes: Stroke[]) => {
      if (!page) return;
      mutate(() => {
        const layer = aiLayer(page);
        for (const stroke of strokes) {
          apply(page, { type: "addStroke", layerId: layer.id, stroke });
          historyOf(page.id).record({ type: "addStroke", layerId: layer.id, stroke });
        }
      });
    },
    [page, mutate, historyOf]
  );

  const setAILayerVisible = useCallback(
    (visible: boolean) => {
      if (!page) return;
      mutate(() => {
        const l = page.layers.find((x) => x.author === "ai");
        if (l) l.visible = visible;
      });
    },
    [page, mutate]
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
        histories.current.clear();
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
      histories.current.clear();
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
    selectedIds, setSelectedIds,
    canUndo, canRedo,
    openNotebook, addNotebook, renameNotebook, removeNotebook,
    addPage, renamePage, deletePage, movePage, selectPage, setPaperStyle,
    commitStroke, beginErase, eraseAt, endErase, selectInRect, deleteSelected,
    undo, redo,
    insertAIStrokes, setAILayerVisible,
    exportNotebook, importNotebook, reloadFromStorage,
  };
}

export type NotebookStore = ReturnType<typeof useNotebook>;
