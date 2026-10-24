import { describe, it, expect } from "vitest";
import {
  LIMITS,
  parseAnswerDocument,
  ANSWER_SCHEMA_VERSION,
} from "@/lib/ai/answerSchema";

const doc = (blocks: unknown[], extra: Record<string, unknown> = {}) => ({
  schemaVersion: ANSWER_SCHEMA_VERSION,
  title: "T",
  blocks,
  ...extra,
});

describe("answerDocumentSchema — valid blocks", () => {
  it("accepts paragraph and heading blocks", () => {
    const d = parseAnswerDocument(doc([
      { id: "b1", type: "heading", level: 2, text: "Intro" },
      { id: "b2", type: "paragraph", text: "Hello $x^2$ inline math." },
    ]));
    expect(d.blocks).toHaveLength(2);
  });

  it("accepts bulleted, numbered, and nested lists up to depth 3", () => {
    const item = (children?: unknown) => ({ text: "item", ...(children ? { children } : {}) });
    const d = parseAnswerDocument(doc([
      { id: "b1", type: "list", style: "numbered", items: [item([item([item()])])] },
      { id: "b2", type: "list", style: "bulleted", items: [item()] },
    ]));
    expect(d.blocks).toHaveLength(2);
  });

  it("rejects list nesting beyond depth 3", () => {
    const deep = { text: "x", children: [{ text: "x", children: [{ text: "x", children: [{ text: "x" }] }] }] };
    expect(() =>
      parseAnswerDocument(doc([{ id: "b1", type: "list", style: "bulleted", items: [deep] }]))
    ).toThrow();
  });

  it("accepts math, derivation, and definition blocks", () => {
    const d = parseAnswerDocument(doc([
      { id: "b1", type: "math", latex: "\\int_0^1 x^2 dx", display: true },
      { id: "b2", type: "derivation", steps: [{ latex: "x^2" }, { latex: "2x", note: "differentiate" }] },
      { id: "b3", type: "definition", term: "Derivative", definition: "Rate of change" },
    ]));
    expect(d.blocks).toHaveLength(3);
  });

  it("accepts code, steps, table, diagram, callout, annotation blocks", () => {
    const d = parseAnswerDocument(doc([
      { id: "b1", type: "code", language: "ts", code: "const x = 1;", explanation: "declares x" },
      { id: "b2", type: "steps", items: ["first", "second"] },
      { id: "b3", type: "table", headers: ["a", "b"], rows: [["1", "2"]] },
      {
        id: "b4", type: "diagram",
        primitives: [
          { type: "box", x: 10, y: 10, w: 30, h: 12, label: "A" },
          { type: "arrow", from: { x: 40, y: 16 }, to: { x: 70, y: 16 } },
          { type: "ellipse", x: 70, y: 10, w: 20, h: 12 },
          { type: "label", x: 50, y: 55, text: "flow" },
        ],
      },
      { id: "b5", type: "callout", kind: "warning", text: "Watch out" },
      { id: "b6", type: "annotation", text: "see above", targetBlockId: "b1" },
    ], { summary: "s", followUpSuggestions: ["more?"] }));
    expect(d.blocks).toHaveLength(6);
    expect(d.summary).toBe("s");
  });
});

describe("answerDocumentSchema — rejections", () => {
  it("rejects unknown block types", () => {
    expect(() => parseAnswerDocument(doc([{ id: "b1", type: "html", text: "<b>x</b>" }]))).toThrow();
    expect(() => parseAnswerDocument(doc([{ id: "b1", type: "iframe" }]))).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => parseAnswerDocument(doc([{ type: "paragraph", text: "no id" }]))).toThrow();
    expect(() => parseAnswerDocument(doc([{ id: "b1", type: "paragraph" }]))).toThrow();
    expect(() => parseAnswerDocument(doc([{ id: "b1", type: "heading", level: 9, text: "x" }]))).toThrow();
    expect(() => parseAnswerDocument(doc([{ id: "b1", type: "code", language: "ts" }]))).toThrow();
  });

  it("rejects oversized content", () => {
    expect(() =>
      parseAnswerDocument(doc([{ id: "b1", type: "paragraph", text: "x".repeat(LIMITS.text + 1) }]))
    ).toThrow();
    expect(() =>
      parseAnswerDocument(doc([{ id: "b1", type: "code", language: "ts", code: "x".repeat(LIMITS.code + 1) }]))
    ).toThrow();
    const tooMany = Array.from({ length: LIMITS.blocks + 1 }, (_, i) => ({
      id: `b${i}`, type: "paragraph", text: "x",
    }));
    expect(() => parseAnswerDocument(doc(tooMany))).toThrow();
    expect(() =>
      parseAnswerDocument(doc([{
        id: "b1", type: "table",
        headers: ["h"],
        rows: Array.from({ length: LIMITS.tableRows + 1 }, () => ["c"]),
      }]))
    ).toThrow();
  });

  it("rejects out-of-range diagram coordinates", () => {
    expect(() =>
      parseAnswerDocument(doc([{
        id: "b1", type: "diagram",
        primitives: [{ type: "box", x: -5, y: 0, w: 10, h: 10 }],
      }]))
    ).toThrow();
  });

  it("rejects unsupported schema versions", () => {
    const d = doc([{ id: "b1", type: "paragraph", text: "x" }]);
    expect(() => parseAnswerDocument({ ...d, schemaVersion: 2 })).toThrow();
    expect(() => parseAnswerDocument({ ...d, schemaVersion: 0 })).toThrow();
  });

  it("rejects verified-status claims and invalid metadata", () => {
    const d = doc([{ id: "b1", type: "paragraph", text: "x" }]);
    expect(() =>
      parseAnswerDocument({ ...d, metadata: { verificationStatus: "verified" } })
    ).toThrow();
    expect(() =>
      parseAnswerDocument({ ...d, metadata: { generatedAt: "yesterday" } })
    ).toThrow();
  });

  it("accepts valid metadata", () => {
    const d = parseAnswerDocument(
      doc([{ id: "b1", type: "paragraph", text: "x" }], {
        metadata: {
          requestId: "r1",
          model: "m",
          generatedAt: 123,
          language: "en",
          warnings: ["w"],
          verificationStatus: "unverified",
        },
      })
    );
    expect(d.metadata?.model).toBe("m");
  });
});
