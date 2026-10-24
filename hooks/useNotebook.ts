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
import { PageHistory, apply, type RemovedStroke } from "@/lib/history/history";
import { strokeHitsPoint, strokeIntersectsRect, simplifyPoints, type Rect } from "@/lib/drawing/geometry";
import * as db from "@/lib/storage/db";
import { downloadNotebook, importNotebookJSON } from "@/lib/storage/exportImport";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

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

  const persist = useCallback(async () => {
    const nb = nbRef.current;
    if (!nb || !dirty.current) return;
    dirty.current = false;
    setSaveStatus("saving");
    try {
      nb.updatedAt = Date.now();
      await db.saveNotebook(nb);
      await db.setLastOpened(nb.id);
      setSaveStatus("saved");
      setMetas(await db.listNotebooks());
      try {
        new BroadcastChannel(CHANNEL).postMessage({ type: "saved", id: nb.id, tab: TAB_ID, updatedAt: nb.updatedAt });
      } catch { /* BroadcastChannel unsupported */ }
    } catch {
      dirty.current = true;
      setSaveStatus("error");
    }
  }, []);

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    setSaveStatus((s) => (s === "error" ? s : "saving"));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, AUTOSAVE_MS);
  }, [persist]);

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

  // flush pending save on unload
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      persist();
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [persist]);

  // multi-tab conflict notice
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e) => {
      const m = e.data;
      if (m?.type === "saved" && m.tab !== TAB_ID && nbRef.current?.id === m.id) {
        if (dirty.current || saveTimer.current) setConflict(true);
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
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        await persist();
      }
      const nb = await db.loadNotebook(id);
      if (!nb) return;
      setNotebook(nb);
      histories.current.clear();
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

  /** Erase all user+ai strokes near a point. Records one undoable op. */
  const eraseAt = useCallback(
    (x: number, y: number, radius: number) => {
      if (!page) return false;
      const removed: RemovedStroke[] = [];
      for (const layer of page.layers) {
        layer.strokes.forEach((s, index) => {
          if (strokeHitsPoint(s, x, y, radius)) removed.push({ layerId: layer.id, index, stroke: s });
        });
      }
      if (removed.length === 0) return false;
      const eraserOp = { id: newId(), targetStrokeIds: removed.map((r) => r.stroke.id), at: Date.now() };
      const op = { type: "eraseStrokes" as const, eraserOp, removed };
      mutate(() => {
        apply(page, op);
        historyOf(page.id).record(op);
      });
      return true;
    },
    [page, mutate, historyOf]
  );

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
    const removed: RemovedStroke[] = [];
    for (const layer of page.layers) {
      layer.strokes.forEach((s, index) => {
        if (wanted.has(s.id)) removed.push({ layerId: layer.id, index, stroke: s });
      });
    }
    const eraserOp = { id: newId(), targetStrokeIds: [...wanted], at: Date.now() };
    const op = { type: "eraseStrokes" as const, eraserOp, removed };
    mutate(() => {
      apply(page, op);
      historyOf(page.id).record(op);
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
    if (saveTimer.current) clearTimeout(saveTimer.current);
    dirty.current = false;
    const fresh = await db.loadNotebook(nb.id);
    if (fresh) {
      setNotebook(fresh);
      histories.current.clear();
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
    commitStroke, eraseAt, selectInRect, deleteSelected,
    undo, redo,
    insertAIStrokes, setAILayerVisible,
    exportNotebook, importNotebook, reloadFromStorage,
  };
}

export type NotebookStore = ReturnType<typeof useNotebook>;
