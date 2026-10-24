"use client";

import type { VoiceState, VoiceToast } from "@/hooks/useVoiceAssistant";

type Props = {
  supported: { recognition: boolean; synthesis: boolean };
  on: boolean;
  state: VoiceState;
  /** Last transcript (interim while speaking, final while being processed). */
  heard: string;
  toast: VoiceToast | null;
  toggle: () => void;
};

const Mic = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
    <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v3" />
  </svg>
);

/**
 * Floating voice orb: the only AI chrome left in the app. Click (or Ctrl+M)
 * to toggle hands-free listening; the ring shows listening/thinking/speaking,
 * and a transient line above it shows what was heard or what went wrong.
 */
export default function VoiceDock({ supported, on, state, heard, toast, toggle }: Props) {
  if (!supported.recognition) return null;

  const ring =
    state === "thinking"
      ? "border-amber-300"
      : state === "speaking"
        ? "border-blue-400"
        : on
          ? "border-red-400"
          : "border-neutral-300";

  return (
    <div className="pointer-events-none absolute bottom-6 right-6 z-10 flex flex-col items-end gap-2">
      {(toast || (on && heard)) && (
        <div
          role={toast?.kind === "error" ? "alert" : "status"}
          className={`pointer-events-auto max-w-xs truncate rounded-full border bg-white/95 px-3 py-1.5 text-xs shadow-sm ${
            toast?.kind === "error" ? "border-red-200 text-red-700" : "border-neutral-200 text-neutral-600"
          }`}
        >
          {toast?.kind === "error"
            ? toast.text
            : toast?.text ?? `Heard: “${heard}”`}
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-label={on ? "Stop listening" : "Start voice assistant"}
        aria-pressed={on}
        title={on ? "Listening — click to stop (Ctrl+M)" : "Talk to the notebook (Ctrl+M)"}
        className={`pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full border-2 bg-white shadow-lg transition hover:scale-105 ${ring} ${
          on ? "text-neutral-900" : "text-neutral-400"
        }`}
      >
        {on && <span className="absolute inset-0 animate-ping rounded-full border-2 border-red-300 opacity-60" aria-hidden />}
        {state === "thinking" ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" aria-hidden />
        ) : state === "speaking" ? (
          <span className="flex items-end gap-0.5" aria-hidden>
            <span className="h-3 w-1 animate-pulse rounded bg-blue-500" />
            <span className="h-5 w-1 animate-pulse rounded bg-blue-500" style={{ animationDelay: "150ms" }} />
            <span className="h-2 w-1 animate-pulse rounded bg-blue-500" style={{ animationDelay: "300ms" }} />
          </span>
        ) : (
          <Mic />
        )}
      </button>
    </div>
  );
}
