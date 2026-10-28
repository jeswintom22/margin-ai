/**
 * Input policy: decides what each pointer does — run a tool, pan, or pinch —
 * independent of the DOM so it can be unit-tested.
 *
 * - Pen draws with the current tool; the eraser end (button 5 / buttons&32)
 *   and barrel button (button 2) map to configurable tools.
 * - Touch: with touch drawing off (or "auto" once a pen was seen) one finger
 *   pans and two fingers pinch-zoom — this is palm rejection. Any touch while
 *   a pen stroke is active is ignored; a pen landing cancels a touch gesture.
 * - Mouse: left = current tool, middle = pan, right = mapped tool or nothing.
 * - Only one tool gesture at a time; extra pointers are ignored.
 */
export type PointerKind = "mouse" | "pen" | "touch";
export type ToolId = "pen" | "highlighter" | "eraser" | "hand" | "select" | "lasso" | "object" | "text" | "shape" | "vspace" | "image" | "play";
export type MappedTool = ToolId | "none";
export type TouchDrawing = "auto" | "on" | "off";

export type RouterInput = {
  id: number;
  type: PointerKind;
  button: number;
  buttons: number;
  x: number;
  y: number;
  pressure: number;
  time: number;
};

export type InputSettings = {
  tool: ToolId;
  touchDrawing: TouchDrawing;
  penEraser: MappedTool;
  penBarrel: MappedTool;
  mouseRight: MappedTool;
};

export const DEFAULT_INPUT: Omit<InputSettings, "tool"> = { touchDrawing: "auto", penEraser: "eraser", penBarrel: "select", mouseRight: "none" };

export interface RouterSink {
  /** Start a tool gesture; return false to refuse (e.g. outside a page). */
  toolBegin(tool: ToolId, e: RouterInput): boolean;
  toolMove(e: RouterInput): void;
  toolEnd(e: RouterInput, canceled: boolean): void;
  pan(dx: number, dy: number): void;
  /** Multiply zoom by `factor`, anchored at client (cx, cy). */
  pinch(factor: number, cx: number, cy: number): void;
}

type Active =
  | { kind: "tool"; id: number; type: PointerKind }
  | { kind: "pan"; id: number; x: number; y: number }
  | { kind: "pinch"; pts: Map<number, { x: number; y: number }> };

export class PointerRouter {
  private active: Active | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  penSeen = false;

  constructor(private sink: RouterSink, private settings: InputSettings) {}

  setSettings(s: InputSettings) {
    this.settings = s;
  }

  get busy() {
    return this.active !== null;
  }

  private touchDraws() {
    const t = this.settings.touchDrawing;
    return t === "on" || (t === "auto" && !this.penSeen);
  }

  private resolveTool(e: RouterInput): MappedTool {
    if (e.type === "pen") {
      if (e.button === 5 || (e.buttons & 32) !== 0) return this.settings.penEraser;
      if (e.button === 2 || (e.buttons & 2) !== 0) return this.settings.penBarrel;
      return this.settings.tool;
    }
    if (e.type === "mouse") {
      if (e.button === 2) return this.settings.mouseRight;
      if (e.button !== 0) return "none";
    }
    return this.settings.tool;
  }

  private startTool(e: RouterInput, tool: ToolId): boolean {
    if (tool === "hand") return this.startPan(e);
    if (!this.sink.toolBegin(tool, e)) return false;
    this.active = { kind: "tool", id: e.id, type: e.type };
    return true;
  }

  private startPan(e: RouterInput): boolean {
    this.active = { kind: "pan", id: e.id, x: e.x, y: e.y };
    return true;
  }

  /** Returns true when the pointer was claimed (caller should capture it). */
  down(e: RouterInput): boolean {
    if (e.type === "touch") this.touches.set(e.id, { x: e.x, y: e.y });

    if (e.type === "pen") {
      this.penSeen = true;
      const a = this.active;
      if (a && (a.kind === "pinch" || (a.kind === "pan" && this.touches.has(a.id)) || (a.kind === "tool" && a.type === "touch"))) {
        this.cancelActive(e); // pen wins over a resting palm/finger
      } else if (a) return false;
      const t = this.resolveTool(e);
      return t !== "none" && this.startTool(e, t);
    }

    if (e.type === "touch") {
      const a = this.active;
      if (a?.kind === "tool" && a.type === "pen") return false; // palm while writing
      if (this.touches.size >= 2) {
        if (a?.kind === "tool" && a.type === "touch") this.cancelActive(e);
        this.active = { kind: "pinch", pts: new Map([...this.touches].slice(-2)) };
        return true;
      }
      if (a) return false;
      return this.touchDraws() ? this.startTool(e, this.settings.tool) : this.startPan(e);
    }

    // mouse
    if (this.active) return false;
    if (e.button === 1) return this.startPan(e);
    const t = this.resolveTool(e);
    return t !== "none" && this.startTool(e, t);
  }

  move(e: RouterInput) {
    if (e.type === "touch" && this.touches.has(e.id)) this.touches.set(e.id, { x: e.x, y: e.y });
    const a = this.active;
    if (!a) return;
    if (a.kind === "tool" && a.id === e.id) this.sink.toolMove(e);
    else if (a.kind === "pan" && a.id === e.id) {
      this.sink.pan(a.x - e.x, a.y - e.y);
      a.x = e.x;
      a.y = e.y;
    } else if (a.kind === "pinch" && a.pts.has(e.id)) {
      const before = [...a.pts.values()];
      a.pts.set(e.id, { x: e.x, y: e.y });
      const after = [...a.pts.values()];
      if (before.length < 2) return;
      const d0 = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
      const d1 = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
      const m0 = { x: (before[0].x + before[1].x) / 2, y: (before[0].y + before[1].y) / 2 };
      const m1 = { x: (after[0].x + after[1].x) / 2, y: (after[0].y + after[1].y) / 2 };
      if (d0 > 0 && d1 > 0 && Math.abs(d1 / d0 - 1) > 1e-4) this.sink.pinch(d1 / d0, m1.x, m1.y);
      this.sink.pan(m0.x - m1.x, m0.y - m1.y);
    }
  }

  up(e: RouterInput, canceled = false) {
    if (e.type === "touch") this.touches.delete(e.id);
    const a = this.active;
    if (!a) return;
    if (a.kind === "tool" && a.id === e.id) {
      this.active = null;
      this.sink.toolEnd(e, canceled);
    } else if (a.kind === "pan" && a.id === e.id) this.active = null;
    else if (a.kind === "pinch" && a.pts.has(e.id)) {
      // Lifting one finger of a pinch continues as a one-finger pan.
      a.pts.delete(e.id);
      const rest = [...a.pts.entries()][0];
      this.active = rest && !this.touchDraws() ? { kind: "pan", id: rest[0], x: rest[1].x, y: rest[1].y } : null;
    }
  }

  private cancelActive(e: RouterInput) {
    const a = this.active;
    this.active = null;
    if (a?.kind === "tool") this.sink.toolEnd({ ...e, id: a.id }, true);
  }

  /** Abort everything (e.g. window blur, notebook switch). */
  reset() {
    const a = this.active;
    this.active = null;
    this.touches.clear();
    if (a?.kind === "tool") this.sink.toolEnd({ id: a.id, type: a.type, button: 0, buttons: 0, x: 0, y: 0, pressure: 0, time: 0 }, true);
  }
}
