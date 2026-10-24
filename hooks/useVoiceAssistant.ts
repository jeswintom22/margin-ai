"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NotebookStore } from "@/hooks/useNotebook";
import { parseIntent } from "@/lib/ai/commands";
import {
  answerToSpeechText,
  createDictation,
  createSpeaker,
  speechSupport,
  type SpeechRecognizer,
  type Speaker,
} from "@/lib/ai/speech";
import type { AskResponse } from "@/lib/ai/types";
import type { NotebookContext } from "@/lib/ai/contextSchema";

export type VoiceState = "off" | "listening" | "thinking" | "speaking";
export type VoiceToast = { kind: "info" | "error"; text: string };

type Capture = { dataUrl: string; width: number; height: number } | null;

type Opts = {
  /** Capture the selected ink region as PNG (null when nothing selected). */
  capture: () => Capture;
  /** Notebook context for the current page (optional grounding). */
  getContext?: () => NotebookContext | null;
};

const RESTART_MS = 300;

/**
 * Hands-free voice assistant: toggles a continuous dictation session, parses
 * each final transcript into an intent, calls /api/ask, writes the answer
 * into the notebook (beside the selection, else at page bottom) and speaks it.
 * Recognition auto-restarts when the browser drops it, and pauses while the
 * speaker is talking so the AI never hears itself.
 *
 * The same transcript handler backs the dev/test hook: `window.__margin`
 * (outside production only) exposes { run(text) } for Playwright.
 */
export function useVoiceAssistant(nb: NotebookStore, opts: Opts) {
  const support = typeof window !== "undefined" ? speechSupport(window) : { recognition: false, synthesis: false };
  const [on, setOn] = useState(false);
  const [state, setState] = useState<VoiceState>("off");
  const [heard, setHeard] = useState("");
  const [toast, setToast] = useState<VoiceToast | null>(null);

  const nbRef = useRef(nb);
  const optsRef = useRef(opts);
  const runRef = useRef<(t: string, e?: { lines?: string[] }) => void>(() => {});
  useEffect(() => {
    nbRef.current = nb;
    optsRef.current = opts;
  });

  const onRef = useRef(false);
  const busy = useRef(false);
  const speaking = useRef(false);
  const recRef = useRef<SpeechRecognizer | null>(null);
  const speakerRef = useRef<Speaker | null>(null);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((kind: VoiceToast["kind"], text: string) => setToast({ kind, text }), []);

  const speak = useCallback((text: string, done: () => void) => {
    speakerRef.current ??= createSpeaker();
    const sp = speakerRef.current;
    // No voices (headless test browsers) → skip speech; utterances would
    // never end and would leave the assistant deaf forever.
    if (!sp || window.speechSynthesis.getVoices().length === 0) { done(); return; }
    speaking.current = true;
    // Mute the recognizer while the AI talks so it can't hear itself; the
    // finish callback reopens it once the utterance ends.
    recRef.current?.abort();
    recRef.current = null;
    setState((s) => (s === "off" ? s : "speaking"));
    // If onend never fires (headless/audioless browsers), don't stay deaf.
    const finish = () => {
      if (!speaking.current) return;
      speaking.current = false;
      done();
      startRec();
    };
    const watchdog = setTimeout(finish, 30_000);
    sp.speak(text, 1, () => {
      clearTimeout(watchdog);
      finish();
    });
  }, []);

  // Plain function (not useCallback): the recognizer's onEnd re-calls it to
  // restart, and a named function declaration self-references cleanly.
  function startRec() {
    if (!onRef.current || recRef.current || speaking.current) return;
    const rec = createDictation(
      {
        onResult: (r) => {
          setHeard(r.text);
          if (r.final === false) return;
          runRef.current(r.text);
        },
        onEnd: () => {
          recRef.current = null;
          // The browser drops the mic periodically; restart while toggled on.
          if (onRef.current) {
            restartTimer.current = setTimeout(startRec, RESTART_MS);
          }
        },
        onError: (kind) => {
          if (kind === "denied") {
            say("error", "Microphone access denied — check the browser permission");
            onRef.current = false;
            setOn(false);
            setState("off");
          } else if (kind !== "no-speech") {
            say("error", "Voice recognition hiccup — still listening");
          }
        },
      },
      { continuous: true }
    );
    if (!rec) return;
    recRef.current = rec;
    try {
      rec.start();
      setState((s) => (s === "off" ? s : "listening"));
    } catch {
      recRef.current = null;
    }
  }

  function toggle() {
    if (onRef.current) {
      onRef.current = false;
      setOn(false);
      setState("off");
      setHeard("");
      if (restartTimer.current) clearTimeout(restartTimer.current);
      recRef.current?.abort();
      recRef.current = null;
      speakerRef.current?.stop();
      return;
    }
    onRef.current = true;
    setOn(true);
    setState("listening");
    setToast(null);
    startRec();
  }

  useEffect(
    () => () => {
      onRef.current = false;
      if (restartTimer.current) clearTimeout(restartTimer.current);
      recRef.current?.abort();
      speakerRef.current?.stop();
    },
    []
  );

  /** One utterance → intent → action. Also the __margin test hook entrypoint.
   *  `extra.lines` supplies pre-transcribed student lines (tests only). */
  async function run(text: string, extra?: { lines?: string[] }) {
      const store = nbRef.current;
      const intent = parseIntent(text, { hasSelection: store.selectedIds.length > 0 });

      if (intent.kind === "control") {
        switch (intent.action) {
          case "undo": store.undo(); say("info", "Undone"); return;
          case "redo": store.redo(); say("info", "Redone"); return;
          case "newPage": store.addPage(); say("info", "New page"); return;
          case "stop": toggle(); return;
        }
      }
      if (busy.current) {
        say("info", "Still thinking — hold on a sec");
        return;
      }
      busy.current = true;
      setState((s) => (s === "off" ? s : "thinking"));

      // Whenever ink is selected it goes along with the question — the user
      // is almost always asking *about* it ("what's this?"), even when the
      // phrasing isn't a recognized tutor command.
      const hasInk = store.selectedIds.length > 0;
      const ids = hasInk ? store.selectedIds : [];
      const pageHasContent =
        !!store.page &&
        (store.page.layers.some((l) => l.strokes.length > 0) || !!store.page.background);
      const image = pageHasContent ? optsRef.current.capture()?.dataUrl : undefined;
      const question =
        intent.kind === "tutor" ? text : intent.kind === "explain" ? intent.question : intent.question;
      const mode = intent.kind === "tutor" ? intent.mode : undefined;
      const body = JSON.stringify({
        question,
        image,
        mode,
        lines: extra?.lines,
        context: optsRef.current.getContext?.() ?? undefined,
      });

      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        const data = (await res.json().catch(() => null)) as AskResponse | null;
        if (!data || !("answer" in data)) {
          const msg = data?.error ?? `Request failed (HTTP ${res.status})`;
          say("error", msg);
          setState((s) => (s === "off" ? s : "listening"));
          return;
        }
        const doc = data.answer;
        if (mode === "check") {
          const check = doc.blocks.find((b) => b.type === "check");
          const g = check && check.type === "check" ? store.insertCheckMarks(check, ids, check.lines.length) : null;
          say(g ? "info" : "error", g ? "Marks written — Ctrl+Z to undo" : "Could not place the marks");
        } else {
          const r = store.insertAnswer(doc, ids);
          say(r.ok ? "info" : "error", r.ok ? "Written — Ctrl+Z to undo" : (r.error ?? "Could not write the answer"));
        }
        speak(answerToSpeechText(doc), () => setState((s) => (s === "off" ? s : "listening")));
      } catch {
        say("error", "Network error — could not reach the server");
        setState((s) => (s === "off" ? s : "listening"));
      } finally {
        busy.current = false;
      }
  }
  useEffect(() => {
    runRef.current = run;
  });

  // `window.__margin.run(text)` drives the same path a spoken utterance
  // would — it just skips the microphone. Used by Playwright; harmless in
  // production since it only calls the app's own client-side code.
  useEffect(() => {
    (window as unknown as { __margin?: { run: (t: string, e?: { lines?: string[] }) => void } }).__margin = {
      run: (t, e) => runRef.current(t, e),
    };
    return () => {
      delete (window as unknown as { __margin?: unknown }).__margin;
    };
  }, []);

  return { supported: support, on, state, heard, toast, toggle, run };
}
