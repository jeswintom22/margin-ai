"use client";

import { useState } from "react";
import { newId } from "@/lib/document/types";
import {
  MAX_QUESTION_LENGTH,
  validateQuestion,
  type AskResponse,
  type AssistantExchange,
} from "@/lib/ai/types";

type Props = { onClose: () => void };

/**
 * Minimal assistant: asks /api/ask and lists the exchanges for this session.
 * Exchanges are kept in memory only; they are not written into the notebook yet.
 */
export default function AssistantPanel({ onClose }: Props) {
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<AssistantExchange[]>([]);
  const [pending, setPending] = useState(false);

  const ask = async () => {
    const invalid = validateQuestion(question);
    if (invalid || pending) return;
    const ex: AssistantExchange = { id: newId(), question: question.trim(), createdAt: Date.now() };
    setExchanges((list) => [...list, ex]);
    setQuestion("");
    setPending(true);
    const update = (patch: Partial<AssistantExchange>) =>
      setExchanges((list) => list.map((x) => (x.id === ex.id ? { ...x, ...patch } : x)));
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: ex.question }),
      });
      const data = (await res.json().catch(() => null)) as AskResponse | null;
      if (data && "answer" in data) update({ answer: data.answer });
      else update({ error: data?.error ?? `Request failed (HTTP ${res.status})` });
    } catch {
      update({ error: "Network error — could not reach the server" });
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
              <p className="whitespace-pre-wrap rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-800">
                {ex.answer}
              </p>
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
