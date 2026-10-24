import { describe, it, expect } from "vitest";
import { parseIntent } from "@/lib/ai/commands";

const sel = { hasSelection: true };
const none = { hasSelection: false };

describe("parseIntent", () => {
  it("maps tutor commands to modes when ink is selected", () => {
    expect(parseIntent("check my work", sel)).toEqual({ kind: "tutor", mode: "check" });
    expect(parseIntent("please check this", sel)).toEqual({ kind: "tutor", mode: "check" });
    expect(parseIntent("grade my answer", sel)).toEqual({ kind: "tutor", mode: "check" });
    expect(parseIntent("read my handwriting", sel)).toEqual({ kind: "tutor", mode: "transcribe" });
    expect(parseIntent("what did I write", sel)).toEqual({ kind: "tutor", mode: "transcribe" });
    expect(parseIntent("finish this", sel)).toEqual({ kind: "tutor", mode: "finish" });
    expect(parseIntent("give me a hint", sel)).toEqual({ kind: "tutor", mode: "hint" });
    expect(parseIntent("I'm stuck", sel)).toEqual({ kind: "tutor", mode: "hint" });
    expect(parseIntent("graph this", sel)).toEqual({ kind: "tutor", mode: "graph" });
    expect(parseIntent("plot the function", sel)).toEqual({ kind: "tutor", mode: "graph" });
  });

  it("falls back to a question when a tutor command has no selection", () => {
    expect(parseIntent("check my work", none)).toEqual({ kind: "ask", question: "check my work" });
    expect(parseIntent("explain this", none)).toEqual({ kind: "ask", question: "explain this" });
  });

  it("maps explain/answer to image-based asks when ink is selected", () => {
    expect(parseIntent("explain this", sel)).toEqual({ kind: "explain", question: "Explain the selected content" });
    expect(parseIntent("answer this", sel)).toEqual({ kind: "explain", question: "Answer the question shown in the selected ink" });
  });

  it("maps control phrases", () => {
    expect(parseIntent("undo that", sel)).toEqual({ kind: "control", action: "undo" });
    expect(parseIntent("undo", sel)).toEqual({ kind: "control", action: "undo" });
    expect(parseIntent("redo", sel)).toEqual({ kind: "control", action: "redo" });
    expect(parseIntent("new page", sel)).toEqual({ kind: "control", action: "newPage" });
    expect(parseIntent("stop listening", sel)).toEqual({ kind: "control", action: "stop" });
    expect(parseIntent("stop", sel)).toEqual({ kind: "control", action: "stop" });
  });

  it("treats anything else as a question", () => {
    expect(parseIntent("what is photosynthesis", sel)).toEqual({ kind: "ask", question: "what is photosynthesis" });
    expect(parseIntent("why is the sky blue", none)).toEqual({ kind: "ask", question: "why is the sky blue" });
  });
});
