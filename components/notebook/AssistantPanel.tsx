"use client";

import { useState } from "react";
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

type Props = {
  onClose: () => void;
  /** Insert an answer into the notebook; returns the result. */
  onInsert: (doc: AnswerDocument) => { ok: boolean; error?: string; pageSpan?: number };
  /** Build a context snapshot for the current page/selection, or null. */
  getContext: () => NotebookContext | null;
  /** True when strokes are selected (enables selection actions). */
  hasSelection: boolean;
};

/**
 * Minimal assistant: asks /api/ask and lists the exchanges for this session.
 * Exchanges are kept in memory only; they are not written into the notebook yet.
 */
export default function AssistantPanel({ onClose, onInsert, getContext, hasSelection }: Props) {
  const [withContext, setWithContext] = useState(false);
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
        body: JSON.stringify({ question: ex.question, context: withContext ? getContext() : undefined }),
      });
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
        </div>
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
