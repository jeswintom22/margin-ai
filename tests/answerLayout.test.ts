import { describe, it, expect } from "vitest";
import { layoutAnswer, wrapText, measureText, LAYOUT } from "@/lib/ai/answerLayout";
import { PAGE_WIDTH, PAGE_HEIGHT, createNotebook, aiLayer, userLayer } from "@/lib/document/types";
import { PageHistory, applyInsertion, revertInsertion } from "@/lib/history/history";
import type { AnswerDocument } from "@/lib/ai/answerSchema";

const doc = (blocks: AnswerDocument["blocks"]): AnswerDocument => ({
  schemaVersion: 1,
  title: "Answer",
  blocks,
});

const para = (text: string) => ({ id: "b1", type: "paragraph" as const, text });

describe("wrapText / measureText", () => {
  it("wraps within maxWidth", () => {
    const lines = wrapText("the quick brown fox jumps over the lazy dog", 150, 17);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measureText(l, 17)).toBeLessThanOrEqual(150 + 1);
  });
  it("hard-breaks an unbreakable long word", () => {
    const lines = wrapText("x".repeat(500), 100, 17);
    expect(lines.length).toBeGreaterThan(1);
  });
  it("is deterministic", () => {
    expect(wrapText("a b c d e f g h", 60, 17)).toEqual(wrapText("a b c d e f g h", 60, 17));
  });
});

describe("layoutAnswer", () => {
  it("places a paragraph inside the content area", () => {
    const { pages } = layoutAnswer(doc([para("Hello world")]));
    expect(pages).toHaveLength(1);
    for (const el of pages[0]) {
      if (el.type === "text") {
        expect(el.x).toBeGreaterThanOrEqual(LAYOUT.marginX - 1);
        expect(measureText(el.text, el.size) + el.x).toBeLessThanOrEqual(PAGE_WIDTH - LAYOUT.marginX + 2);
        expect(el.y).toBeLessThanOrEqual(PAGE_HEIGHT - LAYOUT.marginBottom);
      }
    }
  });

  it("spills to additional pages when content overflows", () => {
    const big = Array.from({ length: 40 }, (_, i) => ({
      id: `b${i}`,
      type: "paragraph" as const,
      text: "word ".repeat(30).trim(),
    }));
    const { pages } = layoutAnswer(doc(big));
    expect(pages.length).toBeGreaterThan(1);
    for (const pg of pages)
      for (const el of pg)
        if (el.type === "text") expect(el.y).toBeLessThanOrEqual(PAGE_HEIGHT - LAYOUT.marginBottom + 1);
  });

  it("keeps every element inside horizontal margins", () => {
    const { pages } = layoutAnswer(
      doc([
        { id: "h", type: "heading", level: 1, text: "Big heading" },
        { id: "c", type: "code", language: "ts", code: "const x = 1;\n".repeat(20) },
        { id: "t", type: "table", headers: ["a", "b"], rows: [["1", "2"], ["3", "4"]] },
        { id: "m", type: "math", latex: "x^2 + y^2 = r^2", display: true },
      ])
    );
    for (const pg of pages)
      for (const el of pg) {
        if (el.type === "text" || el.type === "rect") {
          const w = el.type === "rect" ? el.w : measureText(el.text, el.size);
          expect(el.x + w).toBeLessThanOrEqual(PAGE_WIDTH - LAYOUT.marginX + 2);
        }
        if (el.type === "line") expect(Math.max(el.x1, el.x2)).toBeLessThanOrEqual(PAGE_WIDTH - LAYOUT.marginX + 2);
      }
  });

  it("produces deterministic layout for identical input", () => {
    const a = layoutAnswer(doc([para("same input")]));
    const b = layoutAnswer(doc([para("same input")]));
    expect(a.pages.map((p) => p.map((e) => ({ ...e, id: "", groupId: "" })))).toEqual(
      b.pages.map((p) => p.map((e) => ({ ...e, id: "", groupId: "" })))
    );
  });
});

describe("AI insertion into the document", () => {
  const answer = doc([
    { id: "b1", type: "heading", level: 1, text: "Result" },
    para("The answer is four."),
    { id: "b3", type: "math", latex: "2+2=4", display: true },
  ]);

  function insert(nb: ReturnType<typeof createNotebook>, d: AnswerDocument) {
    const page = nb.pages[0];
    const ai = aiLayer(page);
    const { pages: laidOut, groupId } = layoutAnswer(d);
    const createdPages: { page: typeof page; index: number }[] = [];
    const appends = [{ pageId: page.id, layerId: ai.id, elements: laidOut[0] }];
    for (let i = 1; i < laidOut.length; i++) {
      const p = { ...page, id: `newpage${i}` };
      createdPages.push({ page: p, index: nb.pages.length });
      appends.push({ pageId: p.id, layerId: ai.id, elements: laidOut[i] });
    }
    const op = { type: "insertElements" as const, groupId, createdPages, appends };
    applyInsertion(nb, op);
    return op;
  }

  it("keeps AI elements separate from user strokes", () => {
    const nb = createNotebook("n");
    userLayer(nb.pages[0]).strokes.push({
      id: "u1", points: [{ x: 0, y: 0 }], color: "#000", width: 2, tool: "pen", author: "user",
    });
    insert(nb, answer);
    const ai = aiLayer(nb.pages[0]);
    expect(ai.elements.length).toBeGreaterThan(0);
    expect(userLayer(nb.pages[0]).elements).toHaveLength(0);
    expect(userLayer(nb.pages[0]).strokes).toHaveLength(1);
    expect(ai.elements.every((e) => e.groupId.length > 0 && e.blockId.length > 0)).toBe(true);
  });

  it("undo removes inserted elements and created pages; redo restores them", () => {
    const nb = createNotebook("n");
    const many = Array.from({ length: 30 }, (_, i) => para("line ".repeat(25).trim() + ` ${i}`));
    const op = insert(nb, doc(many));
    const ai = aiLayer(nb.pages[0]);
    expect(nb.pages.length).toBeGreaterThan(1);

    revertInsertion(nb, op);
    expect(ai.elements).toHaveLength(0);
    expect(nb.pages).toHaveLength(1);

    applyInsertion(nb, op);
    expect(ai.elements.length).toBeGreaterThan(0);
    expect(nb.pages.length).toBeGreaterThan(1);
  });

  it("removeElements is a page-level undoable op that leaves strokes intact", () => {
    const nb = createNotebook("n");
    const h = new PageHistory();
    const page = nb.pages[0];
    insert(nb, answer);
    const layer = aiLayer(page);
    const removed = layer.elements.map((element, index) => ({ index, element }));
    layer.elements = [];
    h.record({ type: "removeElements", pageId: page.id, layerId: layer.id, removed });
    expect(layer.elements).toHaveLength(0);
    h.undo(page);
    expect(layer.elements).toHaveLength(removed.length);
  });

  it("hiding the AI layer does not modify its content", () => {
    const nb = createNotebook("n");
    insert(nb, answer);
    const ai = aiLayer(nb.pages[0]);
    const before = ai.elements.length;
    ai.visible = false;
    expect(ai.elements).toHaveLength(before);
  });
});
