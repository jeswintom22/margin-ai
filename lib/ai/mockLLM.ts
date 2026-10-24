import type { ChatOptions, ChatResult } from "./llm";
import { parseLine } from "@/lib/math/verify";
import { safeDerivative } from "@/lib/math/safeMath";

/**
 * Deterministic dev/test provider (LLM_MOCK=true, never in production). It
 * returns valid AnswerDocument JSON per tutor mode so every feature can be
 * exercised without an API key. It cannot read images: transcription returns
 * fixed demo lines.
 */

export const MOCK_TRANSCRIPTION = ["g(x) = 6x^2", "g'(x) = 12x"];

function textOf(content: ChatOptions["messages"][number]["content"]): string {
  return typeof content === "string" ? content : content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
}

function studentLines(user: string): string[] {
  const m = /\[Student work[^\]]*\]\n([\s\S]*?)\n\[End of student work\]/.exec(user);
  return m ? m[1].split("\n").map((l) => l.replace(/^\d+:\s*/, "")) : [];
}

function doc(title: string, blocks: unknown[]) {
  return JSON.stringify({ schemaVersion: 1, title, blocks });
}

export function mockCompletion(opts: ChatOptions): ChatResult {
  const system = textOf(opts.messages.find((m) => m.role === "system")?.content ?? "");
  const user = textOf(opts.messages.filter((m) => m.role === "user").at(-1)?.content ?? "");
  const mode = /MODE: (\w+)/.exec(system)?.[1];
  const parsedLines = studentLines(user);
  // Tutor modes can arrive with only an ink image (no text lines); the mock
  // "reads" the image as the fixed demo transcription.
  const lines = parsedLines.length ? parsedLines : mode === "transcribe" ? [] : MOCK_TRANSCRIPTION;
  const defs = lines.map(parseLine).filter((p) => p?.kind === "def");

  let content: string;
  switch (mode) {
    case "transcribe":
      content = doc("Transcription", [{ id: "b1", type: "steps", items: MOCK_TRANSCRIPTION }]);
      break;
    case "check":
      content = doc("Check", [
        { id: "b1", type: "check", lines: lines.map((_, i) => ({ lineIndex: i, status: "correct" })) },
      ]);
      break;
    case "finish": {
      const last = defs.at(-1);
      let next = "Continue by simplifying the last line.";
      if (last?.kind === "def") {
        try {
          next = `${last.name}${"'".repeat(last.primes + 1)}(${last.v}) = ${safeDerivative(last.expr, last.v).toString()}`;
        } catch {
          /* keep generic text */
        }
      }
      content = doc("Next steps", [{ id: "b1", type: "derivation", steps: [{ latex: next, note: "Differentiate again" }] }]);
      break;
    }
    case "hint":
      content = doc("Hint", [{ id: "b1", type: "callout", kind: "tip", text: "Start with the power rule: d/dx xⁿ = n·xⁿ⁻¹." }]);
      break;
    case "graph": {
      const f = defs.find((d) => d?.kind === "def" && d.primes === 0);
      const expr = f?.kind === "def" ? f.expr : "x^2";
      const label = f?.kind === "def" ? `${f.name}(${f.v})` : "y";
      content = doc("Graph", [{ id: "b1", type: "graph", expressions: [{ expr, label }], xRange: [-3, 3] }]);
      break;
    }
    default:
      content = doc("Mock answer", [{ id: "b1", type: "paragraph", text: `Mock answer to: ${user.slice(0, 80)}` }]);
  }
  return { content, model: "mock" };
}
