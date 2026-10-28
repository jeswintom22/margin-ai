import { describe, expect, it } from "vitest";
import { PointerRouter, DEFAULT_INPUT, type RouterInput, type RouterSink, type ToolId } from "@/lib/engine/input";

function setup(tool: ToolId = "pen", extra: Partial<typeof DEFAULT_INPUT> = {}) {
  const log: string[] = [];
  const sink: RouterSink = {
    toolBegin: (t, e) => (log.push(`begin:${t}:${e.id}`), true),
    toolMove: (e) => log.push(`move:${e.id}`),
    toolEnd: (e, c) => log.push(`end:${e.id}${c ? ":cancel" : ""}`),
    pan: (dx, dy) => log.push(`pan:${dx},${dy}`),
    pinch: (f) => log.push(`pinch:${f.toFixed(2)}`),
  };
  const r = new PointerRouter(sink, { tool, ...DEFAULT_INPUT, ...extra });
  return { r, log };
}

const ev = (id: number, type: RouterInput["type"], x = 0, y = 0, button = 0, buttons = 1): RouterInput => ({ id, type, button, buttons, x, y, pressure: 0.5, time: 0 });

describe("PointerRouter", () => {
  it("mouse left draws with the current tool, middle pans, right is unmapped by default", () => {
    const { r, log } = setup();
    expect(r.down(ev(1, "mouse"))).toBe(true);
    r.move(ev(1, "mouse", 5, 5));
    r.up(ev(1, "mouse"));
    expect(log).toEqual(["begin:pen:1", "move:1", "end:1"]);
    expect(r.down(ev(2, "mouse", 10, 10, 1, 4))).toBe(true);
    r.move(ev(2, "mouse", 4, 7));
    expect(log.at(-1)).toBe("pan:6,3");
    r.up(ev(2, "mouse"));
    expect(r.down(ev(3, "mouse", 0, 0, 2, 2))).toBe(false);
  });

  it("pen eraser end and barrel button map to configured tools", () => {
    const { r, log } = setup();
    r.down(ev(1, "pen", 0, 0, 5, 32));
    r.up(ev(1, "pen"));
    r.down(ev(2, "pen", 0, 0, 0, 32)); // some devices report only buttons&32
    r.up(ev(2, "pen"));
    r.down(ev(3, "pen", 0, 0, 2, 2));
    expect(log.filter((l) => l.startsWith("begin"))).toEqual(["begin:eraser:1", "begin:eraser:2", "begin:select:3"]);
  });

  it("touch draws until a pen is seen (auto), then pans", () => {
    const { r, log } = setup();
    r.down(ev(1, "touch"));
    r.up(ev(1, "touch"));
    expect(log[0]).toBe("begin:pen:1");
    r.down(ev(2, "pen"));
    r.up(ev(2, "pen"));
    log.length = 0;
    r.down(ev(3, "touch", 10, 10));
    r.move(ev(3, "touch", 10, 0));
    expect(log).toEqual(["pan:0,10"]);
  });

  it("ignores a palm while the pen is writing", () => {
    const { r, log } = setup();
    r.down(ev(1, "pen"));
    expect(r.down(ev(2, "touch"))).toBe(false);
    r.move(ev(2, "touch", 50, 50));
    r.up(ev(2, "touch"));
    r.up(ev(1, "pen"));
    expect(log).toEqual(["begin:pen:1", "end:1"]);
  });

  it("a pen landing cancels a touch stroke (palm touched first)", () => {
    const { r, log } = setup("pen", { touchDrawing: "on" });
    r.down(ev(1, "touch"));
    r.down(ev(2, "pen"));
    expect(log).toEqual(["begin:pen:1", "end:1:cancel", "begin:pen:2"]);
  });

  it("second finger turns a touch stroke into a pinch; lifting one continues as pan", () => {
    const { r, log } = setup("pen", { touchDrawing: "off" });
    r.down(ev(1, "touch", 0, 0));
    r.down(ev(2, "touch", 100, 0));
    r.move(ev(2, "touch", 200, 0));
    expect(log.some((l) => l.startsWith("pinch:2.00"))).toBe(true);
    r.up(ev(2, "touch"));
    log.length = 0;
    r.move(ev(1, "touch", 0, 10));
    expect(log).toEqual(["pan:0,-10"]);
  });

  it("hand tool pans with any pointer", () => {
    const { r, log } = setup("hand");
    r.down(ev(1, "pen", 5, 5));
    r.move(ev(1, "pen", 0, 0));
    expect(log).toEqual(["pan:5,5"]);
  });

  it("refused tool begin does not claim the pointer", () => {
    const { r } = setup();
    (r as unknown as { sink: RouterSink }).sink.toolBegin = () => false; // test-only override
    expect(r.down(ev(1, "mouse"))).toBe(false);
    expect(r.busy).toBe(false);
  });

  it("reset cancels an active tool gesture", () => {
    const { r, log } = setup();
    r.down(ev(1, "mouse"));
    r.reset();
    expect(log.at(-1)).toBe("end:1:cancel");
  });
});
