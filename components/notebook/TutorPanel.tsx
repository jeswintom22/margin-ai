"use client";

import { useState } from "react";
import AnswerView from "@/components/notebook/AnswerView";
import type { AnswerDocument } from "@/lib/ai/answerSchema";
import type { AskResponse } from "@/lib/ai/types";

type CheckBlock = Extract<AnswerDocument["blocks"][number], { type: "check" }>;
type Action = "check" | "finish" | "hint" | "graph";
type Capture = { dataUrl: string; width: number; height: number };

type Props = {
  hasSelection: boolean;
  captureSelection: () => Capture | null;
  /** Write check marks beside the selection; returns the mark group id. */
  onMarks: (check: CheckBlock, lineCount: number) => string | null;
  /** Insert an answer beside the selection; returns its group id. */
  onPlace: (doc: AnswerDocument) => { ok: boolean; error?: string; groupId?: string };
  onRemoveGroup: (groupId: string) => void;
  onThinking: (busy: boolean) => void;
};

const ACTIONS: { id: Action; label: string; question: string }[] = [
  { id: "check", label: "Check my work", question: "Check my work line by line." },
  { id: "finish", label: "Finish this", question: "Continue my calculation." },
  { id: "hint", label: "Hint: how do I start?", question: "Give me one hint to start." },
  { id: "graph", label: "Graph this", question: "Graph the function in my work." },
];

async function ask(body: Record<string, unknown>): Promise<AnswerDocument> {
  const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => null)) as AskResponse | null;
  if (data && "answer" in data) return data.answer;
  throw new Error(data?.error ?? `Request failed (HTTP ${res.status})`);
}

/**
 * Tutor workflow on selected ink: transcribe (vision) → user edits the
 * transcription → Check / Finish / Hint / Graph using the edited text.
 * Results go beside the work on the AI layer and are removable/undoable.
 */
export default function TutorPanel({ hasSelection, captureSelection, onMarks, onPlace, onRemoveGroup, onThinking }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnswerDocument | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    onThinking(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
      onThinking(false);
    }
  };

  const transcribe = () =>
    run("Reading handwriting…", async () => {
      const img = captureSelection();
      if (!img) throw new Error("Select your work on the page first");
      const doc = await ask({ question: "Transcribe my handwritten work.", image: img.dataUrl, capability: "vision", mode: "transcribe" });
      const steps = doc.blocks.find((b) => b.type === "steps");
      if (!steps || steps.type !== "steps") throw new Error("The transcription came back empty");
      setText(steps.items.join("\n"));
      setResult(null);
      setGroupId(null);
    });

  const act = (a: (typeof ACTIONS)[number]) =>
    run(`${a.label}…`, async () => {
      const doc = await ask({ question: a.question, mode: a.id, lines });
      setResult(doc);
      if (a.id === "check") {
        const check = doc.blocks.find((b): b is CheckBlock => b.type === "check");
        if (!check) throw new Error("The check result was missing");
        const g = onMarks(check, lines.length);
        setGroupId(g);
        if (!g) throw new Error("Could not place marks — is your work still selected?");
      } else {
        const r = onPlace(doc);
        if (!r.ok) throw new Error(r.error ?? "Could not write the answer");
        setGroupId(r.groupId ?? null);
      }
    });

  return (
    <section aria-label="Tutor" className="space-y-2 border-b border-neutral-200 p-2">
      <button
        type="button"
        disabled={!hasSelection || !!busy}
        title={hasSelection ? "Read the selected handwriting with the vision model" : "Select or lasso your work first"}
        onClick={transcribe}
        className="w-full rounded-md border border-blue-300 bg-blue-50 px-2 py-1.5 text-sm text-blue-800 hover:bg-blue-100 disabled:opacity-40"
      >
        1. Read my handwriting
      </button>
      <label className="block text-xs text-neutral-600">
        2. Transcription — fix anything misread (recognition can be wrong; never verified)
        <textarea
          aria-label="Transcription of your work"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={Math.min(8, Math.max(3, lines.length + 1))}
          placeholder={"One line per row, e.g.\ng(x) = 6x^2\ng'(x) = 12x"}
          className="mt-1 w-full resize-y rounded-md border border-neutral-300 bg-white px-2 py-1 font-mono text-sm"
        />
      </label>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tutor actions">
        {ACTIONS.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={!lines.length || !!busy || (a.id === "check" && !hasSelection)}
            title={a.id === "check" && !hasSelection ? "Keep your work selected so marks can be placed beside it" : undefined}
            onClick={() => act(a)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
          >
            {a.label}
          </button>
        ))}
      </div>
      {busy && <p role="status" className="text-xs text-neutral-500">{busy}</p>}
      {error && <p role="alert" className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
      {result && (
        <div className="rounded-md border border-neutral-200 bg-white p-2">
          <AnswerView doc={result} />
          {groupId && (
            <button
              type="button"
              onClick={() => { onRemoveGroup(groupId); setGroupId(null); }}
              className="mt-1.5 rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
            >
              Undo AI answer
            </button>
          )}
        </div>
      )}
    </section>
  );
}
