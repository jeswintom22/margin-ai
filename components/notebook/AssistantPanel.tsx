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
  /** Tutor workflow UI, shown when the Tutor mode is selected. */
  tutor?: React.ReactNode;
};

/** An exchange plus the ink image (if any) that was sent with it. */
type Exchange = AssistantExchange & { image?: string };

const Icon = ({ d, className = "h-4 w-4" }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    <path d={d} />
  </svg>
);
const ICONS = {
  close: "M18 6 6 18M6 6l12 12",
  send: "M5 12h14M13 6l6 6-6 6",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v3",
  speaker: "M11 5 6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13",
  pause: "M8 5v14M16 5v14",
  stop: "M6 6h12v12H6z",
  pen: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z",
  check: "M20 6 9 17l-5-5",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  retry: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z",
};

/**
 * Assistant side panel: Tutor workflow and a free-form Ask chat backed by
 * /api/ask. Exchanges are kept in memory only; they are not written into the
 * notebook unless the user chooses "Write to Notebook".
 */
export default function AssistantPanel({ onClose, onInsert, getContext, hasSelection, captureSelection, tutor }: Props) {
  const [mode, setMode] = useState<"ask" | "tutor">(tutor ? "tutor" : "ask");
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
    speaker.current.speak(answerToSpeechText(doc), rate, () => {
      // Ignore the end event of an utterance that a newer playback replaced.
      setPlayingId((cur) => (cur === id ? null : cur));
      setPaused(false);
    });
    setPlayingId(id);
    setPaused(false);
  };
  const stopSpeak = () => { speaker.current?.stop(); setPlayingId(null); setPaused(false); };
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [pending, setPending] = useState(false);

  const update = (id: string, patch: Partial<Exchange>) =>
    setExchanges((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const listEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { listEnd.current?.scrollIntoView({ block: "end" }); }, [exchanges]);

  /** Request bodies by exchange id, so Retry re-sends exactly the same request. */
  const bodies = useRef(new Map<string, string>());

  const send = async (id: string, body: string) => {
    setPending(true);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body });
      const data = (await res.json().catch(() => null)) as AskResponse | null;
      if (data && "answer" in data) update(id, { answer: data.answer });
      else update(id, { error: data?.error ?? `Request failed (HTTP ${res.status})` });
    } catch {
      update(id, { error: "Network error — could not reach the server" });
    } finally {
      setPending(false);
    }
  };

  const ask = () => {
    if (validateQuestion(question) || pending) return;
    const ex: Exchange = { id: newId(), question: question.trim(), createdAt: Date.now(), image: pendingImage?.dataUrl };
    const body = JSON.stringify({
      question: ex.question,
      context: withContext ? getContext() : undefined,
      image: pendingImage?.dataUrl,
      capability: pendingImage ? "vision" : undefined,
    });
    bodies.current.set(ex.id, body);
    setExchanges((list) => [...list, ex]);
    setQuestion("");
    setPendingImage(null);
    send(ex.id, body);
  };

  const retry = (ex: Exchange) => {
    const body = bodies.current.get(ex.id);
    if (!body || pending) return;
    update(ex.id, { error: undefined });
    send(ex.id, body);
  };

  const explainSelection = () => {
    // Ink is only readable by the model as an image; attach the
    // captured selection so the explanation is grounded in it.
    const cap = captureSelection?.();
    if (cap) setPendingImage(cap);
    setQuestion("Explain the selected content");
    setWithContext(true);
  };
  const summarizePage = () => { setQuestion("Summarize this page"); setWithContext(true); };
  const readHandwriting = () => {
    const cap = captureSelection?.();
    if (!cap) { setDictErr("Nothing selected to capture"); return; }
    setPendingImage(cap);
    if (!question.trim()) setQuestion("Read this handwriting");
  };

  const chip =
    "shrink-0 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40";
  const ghostBtn =
    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900";
  const quickActions = (
    <>
      <button type="button" className={chip} disabled={!hasSelection}
        title={hasSelection ? "Ask about the selected ink" : "Select strokes on the page first"} onClick={explainSelection}>
        Explain selection
      </button>
      <button type="button" className={chip} onClick={summarizePage}>Summarize page</button>
      {captureSelection && (
        <button type="button" className={chip} disabled={!hasSelection}
          title={hasSelection ? "Capture selected ink and send it to the vision model" : "Select ink on the page first"} onClick={readHandwriting}>
          Read handwriting
        </button>
      )}
    </>
  );

  return (
    <aside
      aria-label="Assistant"
      className="flex w-[22rem] shrink-0 flex-col border-l border-neutral-200 bg-neutral-50 max-sm:absolute max-sm:right-0 max-sm:z-20 max-sm:h-full max-sm:w-full max-sm:shadow-xl"
    >
      <header className="flex items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-600 text-white">
          <Icon d={ICONS.sparkle} className="h-3.5 w-3.5" />
        </span>
        <h2 className="text-sm font-semibold text-neutral-900">Assistant</h2>
        {tutor && (
          <div role="radiogroup" aria-label="Assistant mode" className="ml-auto flex rounded-lg bg-neutral-100 p-0.5 text-xs">
            {(["tutor", "ask"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={`rounded-md px-3 py-1 font-medium transition ${mode === m ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}
              >
                {m === "tutor" ? "Tutor" : "Ask"}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          aria-label="Close assistant"
          onClick={onClose}
          className={`${tutor ? "" : "ml-auto "}flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900`}
        >
          <Icon d={ICONS.close} />
        </button>
      </header>

      {/* Kept mounted while hidden so tutor progress survives tab switches. */}
      {tutor && <div className={mode === "tutor" ? "min-h-0 flex-1 overflow-y-auto bg-white" : "hidden"}>{tutor}</div>}

      {mode === "ask" && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {exchanges.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <Icon d={ICONS.sparkle} className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-medium text-neutral-800">Ask about your notes</p>
                  <p className="mt-1 text-xs text-neutral-500">Select some ink on the page, or try one of these:</p>
                </div>
                <div className="flex flex-wrap justify-center gap-1.5">{quickActions}</div>
              </div>
            ) : (
              <ol className="space-y-4" aria-live="polite">
                {exchanges.map((ex) => (
                  <li key={ex.id} className="space-y-2">
                    <div className="ml-8 flex flex-col items-end gap-1">
                      {ex.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={ex.image} alt="Attached ink" className="max-h-20 rounded-lg border border-neutral-200 bg-white" />
                      )}
                      <p className="whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-blue-600 px-3 py-2 text-sm text-white">
                        {ex.question}
                      </p>
                    </div>

                    {ex.answer && (
                      <div className="mr-2 rounded-2xl rounded-bl-sm border border-neutral-200 bg-white shadow-sm">
                        <div className="px-3 py-2.5">
                          <AnswerView doc={ex.answer} />
                        </div>
                        <div className="flex items-center gap-1 border-t border-neutral-100 px-2 py-1.5">
                          <button
                            type="button"
                            aria-label={playingId === ex.id && !paused ? "Pause answer" : "Read answer aloud"}
                            onClick={() => toggleSpeak(ex.id, ex.answer!)}
                            className={ghostBtn}
                          >
                            <Icon d={playingId === ex.id && !paused ? ICONS.pause : ICONS.speaker} className="h-3.5 w-3.5" />
                            {playingId === ex.id ? (paused ? "Resume" : "Pause") : "Listen"}
                          </button>
                          {playingId === ex.id && (
                            <button type="button" aria-label="Stop playback" onClick={stopSpeak} className={ghostBtn}>
                              <Icon d={ICONS.stop} className="h-3.5 w-3.5" />
                              Stop
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={ex.inserted}
                            onClick={() => {
                              if (ex.inserted) return;
                              const r = onInsert(ex.answer!);
                              update(ex.id, {
                                inserted: r.ok,
                                insertedNote: r.ok
                                  ? `Inserted${r.pageSpan && r.pageSpan > 1 ? ` across ${r.pageSpan} pages` : ""} — Ctrl+Z to undo`
                                  : (r.error ?? "Insertion failed"),
                              });
                            }}
                            className="ml-auto inline-flex items-center gap-1 rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-neutral-700 disabled:cursor-default disabled:bg-green-50 disabled:text-green-700"
                          >
                            <Icon d={ex.inserted ? ICONS.check : ICONS.pen} className="h-3.5 w-3.5" />
                            {ex.inserted ? "Written" : "Write to Notebook"}
                          </button>
                        </div>
                        {ex.insertedNote && (
                          <p className={`border-t border-neutral-100 px-3 py-1.5 text-[11px] ${ex.inserted ? "text-neutral-500" : "text-red-600"}`}>
                            {ex.insertedNote}
                          </p>
                        )}
                      </div>
                    )}

                    {ex.error && (
                      <div role="alert" className="mr-2 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                        <Icon d={ICONS.alert} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 break-words">{ex.error}</span>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => retry(ex)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-200 bg-white px-1.5 py-0.5 font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                        >
                          <Icon d={ICONS.retry} className="h-3 w-3" />
                          Retry
                        </button>
                      </div>
                    )}

                    {!ex.answer && !ex.error && (
                      <div role="status" aria-label="Thinking" className="flex w-fit items-center gap-1 rounded-2xl rounded-bl-sm border border-neutral-200 bg-white px-3 py-2.5">
                        {[0, 150, 300].map((d) => (
                          <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400" style={{ animationDelay: `${d}ms` }} />
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
            <div ref={listEnd} />
          </div>

          <form
            className="space-y-2 border-t border-neutral-200 bg-white p-3"
            onSubmit={(e) => {
              e.preventDefault();
              ask();
            }}
          >
            {exchanges.length > 0 && <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5">{quickActions}</div>}

            {pendingImage && (
              <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pendingImage.dataUrl} alt={`Selected ink, ${pendingImage.width}×${pendingImage.height}px`} className="h-10 rounded border border-neutral-200 bg-white" />
                <span className="text-xs text-blue-900">Selected ink attached</span>
                <button type="button" aria-label="Remove image" onClick={() => setPendingImage(null)}
                  className="ml-auto flex h-6 w-6 items-center justify-center rounded text-blue-900 hover:bg-blue-100">
                  <Icon d={ICONS.close} className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {(dict === "recording" || dict === "processing" || dictErr) && (
              <div className="flex items-center gap-2 text-xs">
                {dict === "recording" && (
                  <>
                    <span role="status" className="flex items-center gap-1.5 text-red-600">
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
                      Recording {elapsed}s
                    </span>
                    <button type="button" onClick={stopDictation} className={ghostBtn}>Stop</button>
                    <button type="button" onClick={cancelDictation} className={ghostBtn}>Cancel</button>
                  </>
                )}
                {dict === "processing" && <span className="text-neutral-500">Transcribing…</span>}
                {dictErr && <span role="alert" className="text-red-600">{dictErr}</span>}
              </div>
            )}

            <div className="rounded-xl border border-neutral-300 bg-white transition focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
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
                rows={2}
                placeholder="Ask anything…"
                className="block w-full resize-none rounded-t-xl bg-transparent px-3 pt-2 text-sm outline-none placeholder:text-neutral-400 focus-visible:outline-none"
              />
              <div className="flex items-center gap-1 px-1.5 pb-1.5">
                {support.recognition && dict !== "recording" && (
                  <button type="button" aria-label="Dictate question" title="Dictate" onClick={startDictation}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900">
                    <Icon d={ICONS.mic} />
                  </button>
                )}
                <label className="flex cursor-pointer select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
                  title="Sends AI text and ink layout only — handwriting isn't read unless you attach it with Read handwriting.">
                  <input type="checkbox" checked={withContext} onChange={(e) => setWithContext(e.target.checked)} className="accent-blue-600" />
                  Include this page
                </label>
                {support.synthesis && (
                  <select aria-label="Speech rate" title="Speech rate" value={rate} onChange={(e) => setRate(Number(e.target.value))}
                    className="rounded-md bg-transparent px-1 py-1 text-xs text-neutral-500 hover:bg-neutral-100">
                    {[0.75, 1, 1.25, 1.5].map((r) => <option key={r} value={r}>{r}×</option>)}
                  </select>
                )}
                <button
                  type="submit"
                  aria-label={pending ? "Asking…" : "Ask"}
                  disabled={pending || !question.trim()}
                  className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white transition hover:bg-blue-700 disabled:bg-neutral-200 disabled:text-neutral-400"
                >
                  {pending
                    ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
                    : <Icon d={ICONS.send} />}
                </button>
              </div>
            </div>
            <p className="text-center text-[10px] text-neutral-400">Enter to send · Shift+Enter for a new line</p>
          </form>
        </>
      )}
    </aside>
  );
}
