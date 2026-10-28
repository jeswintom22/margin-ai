"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor } from "@/lib/engine/Editor";
import { AssetCache } from "@/lib/engine/render/assets";
import { AutoSaver, type SaveState } from "@/lib/storage/autosave";
import * as store from "@/lib/store/db";
import { createNotebook, newId, placeholderNotebook } from "@/lib/xdoc/factories";
import type { NotebookMeta } from "@/lib/xdoc/types";
import { parseFile, serializeFile, type FileBlob } from "@/lib/io/jsonFile";

const CHANNEL = "margin-v4-tabs";
const TAB_ID = newId();

/**
 * Notebook session: storage, autosave, the notebook library and file
 * import/export around one long-lived Editor instance.
 */
export function useSession(opts: { autosaveMs?: number } = {}) {
  const editor = useMemo(() => new Editor(placeholderNotebook()), []);
  const assets = useMemo(() => new AssetCache(async (id) => (await store.getBlob(id))?.data), []);
  const [loading, setLoading] = useState(true);
  const [metas, setMetas] = useState<NotebookMeta[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveState>("idle");
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [conflict, setConflict] = useState(false);
  const saver = useRef<AutoSaver | null>(null);
  const available = useRef(true);

  const refreshMetas = useCallback(async () => {
    if (available.current) setMetas(await store.listNotebooks());
  }, []);

  // Autosave
  useEffect(() => {
    saver.current = new AutoSaver({
      delayMs: opts.autosaveMs ?? 800,
      onStatus: setSaveStatus,
      save: async () => {
        if (!available.current) return;
        await store.saveNotebook(editor.doc);
        await store.setMeta("lastOpened", editor.doc.id);
        await refreshMetas();
        try {
          const ch = new BroadcastChannel(CHANNEL);
          ch.postMessage({ type: "saved", id: editor.doc.id, tab: TAB_ID });
          ch.close();
        } catch {
          /* BroadcastChannel unsupported */
        }
      },
    });
    editor.setDirtyHandler(() => saver.current?.markDirty());
    const flush = () => void saver.current?.flush();
    const onVis = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      editor.setDirtyHandler(null);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [editor, opts.autosaveMs, refreshMetas]);

  // Another tab saved the notebook we have unsaved edits in.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e) => {
      const m = e.data;
      if (m?.type === "saved" && m.tab !== TAB_ID && m.id === editor.doc.id && saver.current?.pending) setConflict(true);
    };
    return () => ch.close();
  }, [editor]);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await store.listNotebooks();
        const last = await store.getMeta<string>("lastOpened");
        let nb = (last && (await store.loadNotebook(last).catch(() => undefined))) || undefined;
        if (!nb && list.length) nb = await store.loadNotebook(list[0].id).catch(() => undefined);
        if (!nb) {
          nb = createNotebook("My Notebook");
          await store.saveNotebook(nb);
        }
        if (cancelled) return;
        editor.load(nb);
        setMetas(await store.listNotebooks());
        setSaveStatus("saved");
      } catch {
        available.current = false;
        setStorageAvailable(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editor]);

  const switchTo = useCallback(
    async (load: () => Promise<void>) => {
      await saver.current?.flush();
      saver.current?.cancelPending();
      await load();
      setConflict(false);
      setSaveStatus("saved");
      await refreshMetas();
    },
    [refreshMetas]
  );

  const open = useCallback(
    (id: string) =>
      switchTo(async () => {
        const nb = await store.loadNotebook(id);
        if (nb) {
          editor.load(nb);
          await store.setMeta("lastOpened", id);
        }
      }),
    [editor, switchTo]
  );

  const create = useCallback(
    (title: string) =>
      switchTo(async () => {
        const nb = createNotebook(title.trim() || "Untitled");
        if (available.current) await store.saveNotebook(nb);
        editor.load(nb);
      }),
    [editor, switchTo]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!available.current) return;
      const isOpen = id === editor.doc.id;
      if (isOpen) saver.current?.cancelPending();
      await store.deleteNotebook(id);
      const list = await store.listNotebooks();
      if (isOpen) {
        let nb = list.length ? await store.loadNotebook(list[0].id) : undefined;
        if (!nb) {
          nb = createNotebook("My Notebook");
          await store.saveNotebook(nb);
        }
        editor.load(nb);
      }
      await refreshMetas();
    },
    [editor, refreshMetas]
  );

  /** Import a .margin.json or legacy Margin AI .json file as a new notebook. */
  const importFile = useCallback(
    async (file: File): Promise<{ ok: true; legacy: boolean } | { ok: false; error: string }> => {
      try {
        const parsed = parseFile(await file.text());
        await switchTo(async () => {
          if (available.current) {
            for (const b of parsed.blobs) await store.putBlobRecord({ id: b.id, kind: b.kind, mime: b.mime, data: b.data });
            await store.saveNotebook(parsed.notebook);
          }
          editor.load(parsed.notebook);
        });
        return { ok: true, legacy: parsed.legacy };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Import failed" };
      }
    },
    [editor, switchTo]
  );

  /** Download the open notebook (with its blobs) as .margin.json. */
  const exportFile = useCallback(async () => {
    const nb = editor.doc;
    const blobs: FileBlob[] = [];
    if (available.current)
      for (const id of store.blobRefs(nb)) {
        const b = await store.getBlob(id);
        if (b) blobs.push({ id: b.id, kind: b.kind, mime: b.mime, data: b.data });
      }
    const text = await serializeFile(nb, blobs);
    download(new Blob([text], { type: "application/json" }), `${safeName(nb.title)}.margin.json`);
  }, [editor]);

  const reloadFromStorage = useCallback(
    () =>
      switchTo(async () => {
        const nb = await store.loadNotebook(editor.doc.id);
        if (nb) editor.load(nb);
      }),
    [editor, switchTo]
  );

  return { editor, assets, loading, metas, saveStatus, storageAvailable, conflict, open, create, remove, importFile, exportFile, reloadFromStorage };
}

export type Session = ReturnType<typeof useSession>;

export function safeName(title: string) {
  return title.replace(/[^\w\- ]/g, "").trim() || "notebook";
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
