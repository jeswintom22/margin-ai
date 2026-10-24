/**
 * Parse a spoken utterance into an intent. Pure, deterministic keyword
 * matching — no LLM round trip, so voice stays fast. When an action needs a
 * selection but nothing is selected, we fall back to a plain question so the
 * user's words are never dropped.
 */

export type VoiceIntent =
  | { kind: "tutor"; mode: "transcribe" | "check" | "finish" | "hint" | "graph" }
  /** Ask the model about the selected ink (image + question). */
  | { kind: "explain"; question: string }
  | { kind: "ask"; question: string }
  | { kind: "control"; action: "undo" | "redo" | "newPage" | "stop" };

type Rule = { re: RegExp; intent: () => VoiceIntent };

const RULES: Rule[] = [
  // ---- controls first so "undo that" never becomes a question ----
  { re: /\bstop (listening|dictat|recording)\b|^\s*stop\s*$/, intent: () => ({ kind: "control", action: "stop" }) },
  { re: /\bundo\b/, intent: () => ({ kind: "control", action: "undo" }) },
  { re: /\bredo\b/, intent: () => ({ kind: "control", action: "redo" }) },
  { re: /\b(new|add|insert|next) page\b/, intent: () => ({ kind: "control", action: "newPage" }) },
  // ---- tutor actions (need selected ink) ----
  { re: /\bcheck\b.{0,20}\b(work|this|it|answer|solution)?\s*$|\bgrade\b/, intent: () => ({ kind: "tutor", mode: "check" }) },
  { re: /\b(read|transcribe|transcribe this|what did i write|my handwriting)\b/, intent: () => ({ kind: "tutor", mode: "transcribe" }) },
  { re: /\b(finish|solve|continue|complete|keep going)\b/, intent: () => ({ kind: "tutor", mode: "finish" }) },
  { re: /\bhint\b|\bhow do i (start|begin|do)\b|\b(stuck|help me out)\b/, intent: () => ({ kind: "tutor", mode: "hint" }) },
  { re: /\b(graph|plot)\b/, intent: () => ({ kind: "tutor", mode: "graph" }) },
  // ---- explain / answer about the selection (image + question) ----
  { re: /\bexplain\b/, intent: () => ({ kind: "explain", question: "Explain the selected content" }) },
  { re: /\b(answer|solve|do) (this|that|it)\b/, intent: () => ({ kind: "explain", question: "Answer the question shown in the selected ink" }) },
];

/**
 * Map a transcript to an intent. `hasSelection` lets selection-dependent
 * commands degrade to a plain question instead of failing.
 */
export function parseIntent(transcript: string, opts: { hasSelection: boolean }): VoiceIntent {
  const q = transcript.trim();
  const norm = q.toLowerCase();
  for (const { re, intent } of RULES) {
    if (!re.test(norm)) continue;
    const v = intent();
    if ((v.kind === "tutor" || v.kind === "explain") && !opts.hasSelection) break; // fall to ask
    return v;
  }
  return { kind: "ask", question: q };
}
