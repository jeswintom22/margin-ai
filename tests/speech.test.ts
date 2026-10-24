import { describe, it, expect } from "vitest";
import { answerToSpeechText } from "@/lib/ai/speech";
import type { AnswerDocument } from "@/lib/ai/answerSchema";

const doc = (blocks: AnswerDocument["blocks"], extra: Partial<AnswerDocument> = {}): AnswerDocument => ({
  schemaVersion: 1, title: "Result", blocks, ...extra,
});

describe("answerToSpeechText", () => {
  it("speaks headings, paragraphs, and numbered lists in order", () => {
    const s = answerToSpeechText(doc([
      { id: "b1", type: "heading", level: 2, text: "Intro" },
      { id: "b2", type: "paragraph", text: "Some text." },
      { id: "b3", type: "list", style: "numbered", items: [{ text: "first" }, { text: "second" }] },
    ]));
    expect(s).toContain("Intro.");
    expect(s).toContain("Item 1: first");
    expect(s).toContain("Item 2: second");
  });

  it("introduces code without reading it", () => {
    const s = answerToSpeechText(doc([{ id: "b1", type: "code", language: "ts", code: "a\nb\nc", explanation: "a loop" }]));
    expect(s).toContain("Code in ts: 3 lines");
    expect(s).not.toContain("a\nb\nc");
    expect(s).toContain("a loop");
  });

  it("renders math readably and falls back for odd latex", () => {
    const s = answerToSpeechText(doc([
      { id: "b1", type: "math", latex: "\\frac{a}{b}", display: true },
      { id: "b2", type: "derivation", steps: [{ latex: "x^2", note: "square it" }] },
    ]));
    expect(s).toContain("a over b");
    expect(s).toContain("x to the power 2");
    expect(s).toContain("square it");
  });

  it("announces tables/diagrams as summaries and keeps summary last", () => {
    const s = answerToSpeechText(doc(
      [
        { id: "b1", type: "table", headers: ["a"], rows: [["1"]] },
        { id: "b2", type: "diagram", primitives: [{ type: "label", x: 1, y: 1, text: "L" }] },
      ],
      { summary: "all done" }
    ));
    expect(s).toContain("Table with 1 columns and 1 rows");
    expect(s.trim().endsWith("Summary: all done")).toBe(true);
  });

  it("does not mutate the document", () => {
    const d = doc([{ id: "b1", type: "math", latex: "x^2", display: true }]);
    const before = JSON.stringify(d);
    answerToSpeechText(d);
    expect(JSON.stringify(d)).toBe(before);
  });
});
