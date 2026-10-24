"use client";

import { useState, useRef, useEffect } from "react";
import { newId } from "@/lib/document/types";
import {
  MAX_QUESTION_LENGTH,
  validateQuestion,
  type AskResponse,
  type AssistantExchange,
} from "@/lib/ai/types";
import AnswerView from "@/components/notebook/AnswerView";
import type { AnswerDocument } from "@/lib/ai/answerSchema";
import type { NotebookContext } from "@/lib/ai/contextSchema";
import {
  createDictation, createSpeaker, speechSupport, answerToSpeechText,
  type DictationState, type SpeechRecognizer, type Speaker,
} from "@/lib/ai/speech";

type Props = {
  onClose: () => void;
  /** Insert an answer into the notebook; returns the result. */
  onInsert: (doc: AnswerDocument) => { ok: boolean; error?: string; pageSpan?: number };
  /** Build a context snapshot for the current page/selection, or null. */
  getContext: () => NotebookContext | null;
  /** True when strokes are selected (enables selection actions). */
  hasSelection: boolean;
  /** Capture the selected ink region as a PNG data URL (null if none). */
  captureSelection?: () => { dataUrl: string; width: number; height: number } | null;
};

/**
 * Minimal assistant: asks /api/ask and lists the exchanges for this session.
 * Exchanges are kept in memory only; they are not written into the notebook yet.
 */
export default function AssistantPanel({ onClose, onInsert, getContext, hasSelection, captureSelection }: Props) {
  const [pendingImage, setPendingImage] = useState<{ dataUrl: string; width: number; height: number } | null>(null);
  const [withContext, setWithContext] = useState(false);
  // voice
  const support = typeof window !== "undefined" ? speechSupport(window) : { recognition: false, synthesis: false };
  const [dict, setDict] = useState<DictationState>("idle");
  const [dictErr, setDictErr] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognizer | null>(null);
  const startedAt = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const speaker = useRef<Speaker | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    if (dict !== "recording") return;
    startedAt.current = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 500);
    return () => clearInterval(t);
  }, [dict]);
  useEffect(() => () => { recRef.current?.abort(); speaker.current?.stop(); }, []);

  const startDictation = () => {
    const rec = createDictation({
      onResult: (r) => { setQuestion((q) => (q ? q + " " : "") + r.text); setDict("idle"); },
      onEnd: () => setDict((d) => (d === "recording" ? "idle" : d)),
      onError: (k) => {
        setDict("error");
        setDictErr(k === "denied" ? "Microphone access denied" : k === "no-speech" ? "No speech detected" : "Dictation failed");
      },
    });
    if (!rec) { setDict("error"); setDictErr("Speech recognition is not supported in this browser"); return; }
    recRef.current = rec;
    setDictErr(null);
    setElapsed(0);
    setDict("recording");
    try { rec.start(); } catch { setDict("error"); setDictErr("Could not start recording"); }
  };
  const stopDictation = () => { setDict("processing"); recRef.current?.stop(); };
  const cancelDictation = () => { recRef.current?.abort(); recRef.current = null; setDict("idle"); };

  const toggleSpeak = (id: string, doc: AnswerDocument) => {
    speaker.current ??= createSpeaker();
    if (!speaker.current) { setDictErr("Speech synthesis is not supported in this browser"); return; }
    if (playingId === id) {
      if (paused) { speaker.current.resume(); setPaused(false); }
      else { speaker.current.pause(); setPaused(true); }
      return;
    }
    speaker.current.speak(answerToSpeechText(doc), rate);
    setPlayingId(id);
    setPaused(false);
  };
  const stopSpeak = () => { speaker.current?.stop(); setPlayingId(null); setPaused(false); };
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<AssistantExchange[]>([]);
  const [pending, setPending] = useState(false);

  const update = (id: string, patch: Partial<AssistantExchange>) =>
    setExchanges((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const ask = async () => {
    const invalid = validateQuestion(question);
    if (invalid || pending) return;
    const ex: AssistantExchange = { id: newId(), question: question.trim(), createdAt: Date.now() };
    setExchanges((list) => [...list, ex]);
    setQuestion("");
    setPending(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: ex.question,
          context: withContext ? getContext() : undefined,
          image: pendingImage?.dataUrl,
          capability: pendingImage ? "vision" : undefined,
        }),
      });
      setPendingImage(null);
      const data = (await res.json().catch(() => null)) as AskResponse | null;
      if (data && "answer" in data) update(ex.id, { answer: data.answer });
      else update(ex.id, { error: data?.error ?? `Request failed (HTTP ${res.status})` });
    } catch {
      update(ex.id, { error: "Network error — could not reach the server" });
    } finally {
      setPending(false);
    }
  };

  return (
    <aside
      aria-label="Assistant"
      className="flex w-80 shrink-0 flex-col border-l border-neutral-200 bg-neutral-50 max-sm:absolute max-sm:right-0 max-sm:z-20 max-sm:h-full max-sm:w-full max-sm:shadow-xl"
    >
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Assistant</h2>
        <button
          type="button"
          aria-label="Close assistant"
          onClick={onClose}
          className="h-7 w-7 rounded text-neutral-500 hover:bg-neutral-200"
        >
          ×
        </button>
      </div>

      <ol className="flex-1 space-y-3 overflow-y-auto px-3 pb-3" aria-live="polite">
        {exchanges.length === 0 && (
          <li className="text-sm text-neutral-400">Ask a question to get started.</li>
        )}
        {exchanges.map((ex) => (
          <li key={ex.id} className="space-y-1.5">
            <p className="rounded-md bg-neutral-200 px-2 py-1.5 text-sm text-neutral-800">{ex.question}</p>
            {ex.answer && (
              <div className="overflow-hidden rounded-md border border-neutral-200 bg-white px-2 py-2">
                <AnswerView doc={ex.answer} />
                <div className="mt-1.5 flex items-center gap-2 border-t border-neutral-100 pt-1.5">
                  <button
                    type="button"
                    aria-label={playingId === ex.id && !paused ? "Pause answer" : "Read answer aloud"}
                    onClick={() => toggleSpeak(ex.id, ex.answer!)}
                    className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
                  >
                    {playingId === ex.id ? (paused ? "Resume" : "Pause") : "Listen"}
                  </button>
                  {playingId === ex.id && (
                    <button type="button" aria-label="Stop playback" onClick={stopSpeak}
                      className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100">
                      Stop
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const r = onInsert(ex.answer!);
                      update(ex.id, {
                        insertedNote: r.ok
                          ? `Inserted${r.pageSpan && r.pageSpan > 1 ? ` across ${r.pageSpan} pages` : ""}`
                          : (r.error ?? "Insertion failed"),
                      });
                    }}
                    className="rounded-md bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700"
                  >
                    Write to Notebook
                  </button>
                  {ex.insertedNote && <span className="text-xs text-neutral-500">{ex.insertedNote}</span>}
                </div>
              </div>
            )}
            {ex.error && (
              <p role="alert" className="rounded-md bg-red-50 px-2 py-1.5 text-sm text-red-700">
                {ex.error}
              </p>
            )}
            {!ex.answer && !ex.error && <p className="text-sm text-neutral-400">Thinking…</p>}
          </li>
        ))}
      </ol>

      <form
        className="border-t border-neutral-200 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          {support.recognition ? (
            dict === "recording" ? (
              <>
                <span role="status" className="flex items-center gap-1 text-xs text-red-600">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
                  Recording {elapsed}s
                </span>
                <button type="button" onClick={stopDictation} className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs">Stop</button>
                <button type="button" onClick={cancelDictation} className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs">Cancel</button>
              </>
            ) : (
              <button type="button" aria-label="Dictate question" onClick={startDictation}
                className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs text-neutral-600">
                🎤 Dictate
              </button>
            )
          ) : (
            <span className="text-xs text-neutral-400" title="Speech recognition not supported in this browser">🎤 n/a</span>
          )}
          {dict === "processing" && <span className="text-xs text-neutral-500">Transcribing…</span>}
          {dictErr && <span role="alert" className="text-xs text-red-600">{dictErr}</span>}
          {support.synthesis && (
            <select aria-label="Speech rate" value={rate} onChange={(e) => setRate(Number(e.target.value))}
              className="ml-auto rounded border border-neutral-300 px-1 py-0.5 text-xs text-neutral-600">
              {[0.75, 1, 1.25, 1.5].map((r) => <option key={r} value={r}>{r}×</option>)}
            </select>
          )}
          <label className="flex items-center gap-1 text-xs text-neutral-600">
            <input
              type="checkbox"
              checked={withContext}
              onChange={(e) => setWithContext(e.target.checked)}
            />
            Include this page
          </label>
          <button
            type="button"
            disabled={!hasSelection}
            title={hasSelection ? "Ask about the selected ink" : "Select strokes on the page first"}
            onClick={() => { setQuestion("Explain the selected content"); setWithContext(true); }}
            className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs text-neutral-600 disabled:opacity-40"
          >
            Explain selection
          </button>
          <button
            type="button"
            onClick={() => { setQuestion("Summarize this page"); setWithContext(true); }}
            className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs text-neutral-600"
          >
            Summarize page
          </button>
          {captureSelection && (
            <button
              type="button"
              disabled={!hasSelection}
              title={hasSelection ? "Capture selected ink and send it to the vision model" : "Select ink on the page first"}
              onClick={() => {
                const cap = captureSelection();
                if (!cap) { setDictErr("Nothing selected to capture"); return; }
                setPendingImage(cap);
                if (!question.trim()) setQuestion("Read this handwriting");
              }}
              className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs text-neutral-600 disabled:opacity-40"
            >
              Read handwriting
            </button>
          )}
        </div>
        {pendingImage && (
          <div className="mb-1 flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-2 py-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pendingImage.dataUrl} alt={`Selected ink, ${pendingImage.width}×${pendingImage.height}px`} className="h-12 rounded border border-neutral-200" />
            <span className="text-xs text-neutral-600">This image will be sent to the vision model</span>
            <button type="button" aria-label="Remove image" onClick={() => setPendingImage(null)} className="ml-auto rounded px-1.5 py-0.5 text-xs text-neutral-600 hover:bg-neutral-200">✕</button>
          </div>
        )}
        <textarea
          aria-label="Question for the assistant"
          value={question}
          maxLength={MAX_QUESTION_LENGTH}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask();
            }
          }}
          rows={3}
          placeholder="Ask anything… (Enter to send, Shift+Enter for a new line)"
          className="w-full resize-none rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={pending || !question.trim()}
          className="mt-1 w-full rounded-md bg-neutral-900 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {pending ? "Asking…" : "Ask"}
        </button>
      </form>
    </aside>
  );
}
