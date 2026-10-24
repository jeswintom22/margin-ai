import { describe, it, expect, vi } from "vitest";
import { CanvasGesture, type GestureEvents } from "@/lib/drawing/gesture";

function makeEvents() {
  return {
    onStrokeCommit: vi.fn(),
    onEraseBegin: vi.fn(),
    onEraseAt: vi.fn(),
    onEraseEnd: vi.fn(),
    onSelectCommit: vi.fn(),
  } satisfies GestureEvents;
}

const P = (x: number, y: number, stamp = 0) => ({ x, y, stamp });

describe("CanvasGesture", () => {
  it("commits a completed pen stroke on pointerup", () => {
    const ev = makeEvents();
    const g = new CanvasGesture(ev);
    expect(g.begin("pen", 1, { x: 0, y: 0 }, 100)).toBe(true);
    g.move(1, [P(10, 10, 110), P(20, 20, 120)]);
    expect(g.end(1, "up")).toBe(true);
    expect(ev.onStrokeCommit).toHaveBeenCalledTimes(1);
    expect(ev.onStrokeCommit.mock.calls[0][0]).toHaveLength(3);
    expect(ev.onStrokeCommit.mock.calls[0][1]).toBe("pen");
  });

  it("does not commit a pen stroke on pointercancel", () => {
    const ev = makeEvents();
    const g = new CanvasGesture(ev);
    g.begin("pen", 1, { x: 0, y: 0 }, 0);
    g.move(1, [P(10, 10, 10), P(20, 20, 20)]);
    g.end(1, "cancel");
    expect(ev.onStrokeCommit).not.toHaveBeenCalled();
    expect(g.active).toBe(false);
    expect(g.points).toHaveLength(0);
  });

  it("does not commit a highlighter stroke on pointercancel", () => {
    const ev = makeEvents();
    const g = new CanvasGesture(ev);
    g.begin("highlighter", 1, { x: 0, y: 0 }, 0);
    g.move(1, [P(30, 30, 10)]);
    g.end(1, "cancel");
    expect(ev.onStrokeCommit).not.toHaveBeenCalled();
  });

  it("a subsequent valid gesture works after cancellation", () => {
    const ev = makeEvents();
    const g = new CanvasGesture(ev);
    g.begin("pen", 1, { x: 0, y: 0 }, 0);
    g.move(1, [P(10, 10, 10)]);
    g.end(1, "cancel");

    expect(g.begin("pen", 2, { x: 50, y: 50 }, 200)).toBe(true);
    g.move(2, [P(60, 60, 210)]);
    g.end(2, "up");
    expect(ev.onStrokeCommit).toHaveBeenCalledTimes(1);
    expect(ev.onStrokeCommit.mock.calls[0][0][0]).toMatchObject({ x: 50, y: 50 });
  });

  it("does not commit twice on pointerup followed by lostpointercapture", () => {
    const ev = makeEvents();
    const g = new CanvasGesture(ev);
    g.begin("pen", 1, { x: 0, y: 0 }, 0);
    g.move(1, [P(5, 5, 5)]);
    expect(g.end(1, "up")).toBe(true);
    // Browsers fire lostpointercapture right after pointerup releases capture.
    expect(g.end(1, "lostCapture")).toBe(false);
    expect(ev.onStrokeCommit).toHaveBeenCalledTimes(1);
  });

  it("commits via lostpointercapture when no pointerup arrived", () => {
    const ev = makeEvents();
    const g = new CanvasGesture(ev);
    g.begin("pen", 1, { x: 0, y: 0 }, 0);
    g.move(1, [P(5, 5, 5)]);
    expect(g.end(1, "lostCapture")).toBe(true);
    expect(ev.onStrokeCommit).toHaveBeenCalledTimes(1);
  });

  it("ignores a second pointerdown while a gesture is active", () => {
    const ev = makeEvents();
    const g = new CanvasGesture(ev);
    g.begin("pen", 1, { x: 0, y: 0 }, 0);
    expect(g.begin("pen", 2, { x: 99, y: 99 }, 1)).toBe(false);
    g.move(2, [P(99, 99, 2)]); // wrong pointer: ignored
    g.end(1, "up");
    expect(ev.onStrokeCommit.mock.calls[0][0]).toHaveLength(1);
  });

  it("runs the full eraser lifecycle exactly once per gesture", () => {
    const ev = makeEvents();
    const g = new CanvasGesture(ev);
    g.begin("eraser", 1, { x: 0, y: 0 }, 0);
    g.move(1, [P(5, 0, 1), P(10, 0, 2)]);
    g.end(1, "up");
    expect(ev.onEraseBegin).toHaveBeenCalledTimes(1);
    expect(ev.onEraseAt).toHaveBeenCalledTimes(3); // down + 2 move samples
    expect(ev.onEraseEnd).toHaveBeenCalledTimes(1);
  });

  it("still ends an eraser gesture on cancel (applied removals commit)", () => {
    const ev = makeEvents();
    const g = new CanvasGesture(ev);
    g.begin("eraser", 1, { x: 0, y: 0 }, 0);
    g.end(1, "cancel");
    expect(ev.onEraseEnd).toHaveBeenCalledTimes(1);
  });

  it("discards a selection rect on cancel and on a too-small drag", () => {
    const ev = makeEvents();
    const g = new CanvasGesture(ev);
    g.begin("select", 1, { x: 0, y: 0 }, 0);
    g.move(1, [P(50, 50, 5)]);
    g.end(1, "cancel");
    expect(ev.onSelectCommit).not.toHaveBeenCalled();

    g.begin("select", 2, { x: 0, y: 0 }, 0);
    g.move(2, [P(1, 1, 5)]); // below MIN_SELECT_SIZE
    g.end(2, "up");
    expect(ev.onSelectCommit).not.toHaveBeenCalled();
  });

  it("commits a selection rect on up", () => {
    const ev = makeEvents();
    const g = new CanvasGesture(ev);
    g.begin("select", 1, { x: 10, y: 10 }, 0);
    g.move(1, [P(40, 30, 5)]);
    g.end(1, "up");
    expect(ev.onSelectCommit).toHaveBeenCalledWith({ x: 10, y: 10, w: 30, h: 20 });
  });
});
