"use client";

import { useSyncExternalStore } from "react";
import type { Editor, EditorUI } from "@/lib/engine/Editor";

/**
 * Subscribe to a slice of the editor UI snapshot. Selectors must return
 * primitives or references held by the snapshot (never fresh objects).
 */
export function useEditorUI<T>(editor: Editor, select: (ui: EditorUI) => T): T {
  return useSyncExternalStore(
    editor.subscribe,
    () => select(editor.getUI()),
    () => select(editor.getUI())
  );
}
