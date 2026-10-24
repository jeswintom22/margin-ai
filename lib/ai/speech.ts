/**
 * Voice input/output adapters. Browser-native Web Speech APIs behind small
 * interfaces so the UI stays decoupled and everything is mockable in tests.
 * No audio leaves the device; nothing is persisted.
 */

import type { AnswerDocument, AnswerBlock, ListItem } from "./answerSchema";

// ---------- types ----------

export type SpeechSupport = { recognition: boolean; synthesis: boolean };

export type DictationState = "idle" | "recording" | "processing" | "error";

export interface DictationResult {
  text: string;
  /** 0..1 when the engine reports it. */
  confidence?: number;
}

/** Minimal engine interface — implemented by WebSpeech or a future provider. */
export interface SpeechRecognizer {
  start(): void;
  stop(): void;
  abort(): void;
}

export type DictationHandlers = {
  onResult: (r: DictationResult) => void;
  onEnd: () => void;
  onError: (kind: "denied" | "no-speech" | "failed") => void;
};

type SR = typeof window & {
  SpeechRecognition?: new () => unknown;
  webkitSpeechRecognition?: new () => unknown;
};

export function speechSupport(win?: unknown): SpeechSupport {
  const w = win as SR | undefined;
  const hasSR = !!w && !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  const synth = !!w && typeof (w as { speechSynthesis?: unknown }).speechSynthesis !== "undefined";
  return { recognition: hasSR, synthesis: !!synth };
}

/**
 * Create a dictation session, or null when the browser has no recognition API.
 * The caller drives state; handlers fire on engine events.
 */
export function createDictation(
  h: DictationHandlers,
  opts: { lang?: string } = {}
): SpeechRecognizer | null {
  const w = window as unknown as SR;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor() as {
    lang: string; interimResults: boolean; continuous: boolean;
    onresult: (e: unknown) => void; onend: () => void;
    onerror: (e: { error?: string }) => void;
    start(): void; stop(): void; abort(): void;
  };
  rec.lang = opts.lang ?? "en-US";
  rec.interimResults = false;
  rec.continuous = false;
  rec.onresult = (e) => {
    const res = (e as { results?: { [k: number]: { transcript?: string; confidence?: number } | undefined }[] }).results;
    const alt = res?.[res.length - 1]?.[0];
    const text = alt?.transcript?.trim();
    if (text) h.onResult({ text, confidence: alt?.confidence });
    else h.onError("no-speech");
  };
  rec.onend = () => h.onEnd();
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") h.onError("denied");
    else if (e.error === "no-speech") h.onError("no-speech");
    else h.onError("failed");
  };
  return rec;
}

// ---------- spoken output ----------

export interface Speaker {
  speak(text: string, rate: number, onEnd?: () => void): void;
  pause(): void;
  resume(): void;
  stop(): void;
  speaking(): boolean;
}

/** Wraps speechSynthesis; null when unsupported. */
export function createSpeaker(): Speaker | null {
  if (!speechSupport(window).synthesis) return null;
  const s = window.speechSynthesis;
  return {
    speak(text, rate, onEnd) {
      s.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate;
      if (onEnd) { u.onend = onEnd; u.onerror = onEnd; }
      s.speak(u);
    },
    pause: () => s.pause(),
    resume: () => s.resume(),
    stop: () => s.cancel(),
    speaking: () => s.speaking || s.pending,
  };
}

// ---------- structured answer → spoken text ----------

function latexToSpeech(latex: string): string {
  return latex
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1 over $2")
    .replace(/\\sqrt\{([^{}]*)\}/g, "the square root of $1")
    .replace(/\^\{?(-?\w+)\}?/g, " to the power $1")
    .replace(/_\{?(\w+)\}?/g, " sub $1")
    .replace(/\\(times|cdot)/g, " times ")
    .replace(/\\(alpha|beta|gamma|delta|theta|pi|sigma|omega)/g, " $1")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[{}$\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "a mathematical expression";
}

function listToSpeech(items: ListItem[], numbered: boolean, out: string[], depth = 0) {
  items.forEach((it, i) => {
    const lead = numbered ? `Item ${i + 1}:` : "";
    out.push(`${"  ".repeat(depth)}${lead} ${it.text}`.trim());
    if (it.children) listToSpeech(it.children, numbered, out, depth + 1);
  });
}

function blockToSpeech(b: AnswerBlock, out: string[]) {
  switch (b.type) {
    case "heading": out.push(`${b.text}.`); break;
    case "paragraph": out.push(b.text); break;
    case "list": listToSpeech(b.items, b.style === "numbered", out); break;
    case "callout": out.push(`${b.kind === "warning" ? "Warning" : b.kind === "tip" ? "Tip" : "Note"}: ${b.text}`); break;
    case "math": out.push(`Equation: ${latexToSpeech(b.latex)}.`); break;
    case "derivation":
      out.push("Derivation:");
      b.steps.forEach((s, i) => out.push(`Step ${i + 1}: ${latexToSpeech(s.latex)}${s.note ? `. ${s.note}` : ""}.`));
      break;
    case "definition": out.push(`${b.term}: ${b.definition}`); break;
    case "code": out.push(`Code in ${b.language}: ${b.code.split("\n").length} lines, not read aloud.${b.explanation ? ` ${b.explanation}` : ""}`); break;
    case "steps":
      out.push(b.title ? `Steps for ${b.title}:` : "Steps:");
      b.items.forEach((s, i) => out.push(`Step ${i + 1}: ${s}`));
      break;
    case "table": out.push(`Table with ${b.headers.length} columns and ${b.rows.length} rows.`); break;
    case "diagram": out.push(b.title ? `Diagram: ${b.title}.` : "A diagram."); break;
    case "annotation": out.push(`Note: ${b.text}`); break;
    case "check":
      b.lines.forEach((l) => out.push(`Line ${l.lineIndex + 1}: ${l.status === "correct" ? "correct" : l.status === "error" ? `error. ${l.note ?? ""}` : "unclear"}${l.verification === "verified" ? ", verified" : ""}.`));
      break;
    case "graph": out.push(`Graph of ${b.expressions.map((e) => latexToSpeech(e.expr)).join(" and ")}, x from ${b.xRange[0]} to ${b.xRange[1]}.`); break;
  }
}

/** Convert a structured answer to speech-friendly text (never mutates it). */
export function answerToSpeechText(doc: AnswerDocument): string {
  const out: string[] = [doc.title + "."];
  for (const b of doc.blocks) blockToSpeech(b, out);
  if (doc.summary) out.push(`Summary: ${doc.summary}`);
  return out.join("\n");
}
