import type { Point } from "@/lib/document/types";
import type { Rect } from "./geometry";

export type GestureTool = "pen" | "highlighter" | "eraser" | "select";

/**
 * How a pointer gesture ended:
 * - `up`          — normal pointerup; commit the gesture's result.
 * - `lostCapture` — capture was lost without a pointerup; treated as `up`
 *   (the gesture ended, so its result is committed). Safe to call after a
 *   normal `up`: the pointer is no longer active and the call is ignored.
 * - `cancel`      — pointercancel; discard in-progress pen/highlighter/select
 *   input. For the eraser it still ends the gesture: removals already applied
 *   during the drag are complete operations and are committed.
 */
export type GestureEnd = "up" | "cancel" | "lostCapture";

export interface GestureEvents {
  onStrokeCommit(points: Point[], tool: "pen" | "highlighter"): void;
  onEraseBegin(): void;
  onEraseAt(x: number, y: number): void;
  onEraseEnd(): void;
  onSelectCommit(rect: Rect): void;
}

export type GestureSample = { x: number; y: number; pressure?: number; stamp: number };

const MIN_POINT_DIST = 0.6; // page units; skips sub-pixel jitter
const MIN_SELECT_SIZE = 2;

/**
 * Tracks one pointer gesture (pointerdown → moves → up/cancel) independently of
 * React. A second pointerdown while a gesture is active is ignored, and any
 * `end` after the gesture has already ended is a no-op, so pointerup followed
 * by lostpointercapture can never commit twice.
 */
export class CanvasGesture {
  private pointerId: number | null = null;
  private tool: GestureTool | null = null;
  private startStamp = 0;
  /** Live in-progress stroke points (pen/highlighter). */
  readonly points: Point[] = [];
  /** Live selection rect (select tool). */
  selection: Rect | null = null;
  private selStart: Point | null = null;

  constructor(private events: GestureEvents) {}

  get active() {
    return this.pointerId !== null;
  }

  get activeTool() {
    return this.tool;
  }

  /** True while a pen/highlighter stroke is being drawn. */
  get drawingStroke() {
    return this.pointerId !== null && (this.tool === "pen" || this.tool === "highlighter");
  }

  /** pointerdown. Returns false (ignores the pointer) if a gesture is active. */
  begin(tool: GestureTool, pointerId: number, p: Point, stamp: number): boolean {
    if (this.pointerId !== null) return false;
    this.pointerId = pointerId;
    this.tool = tool;
    this.startStamp = stamp;
    if (tool === "eraser") {
      this.events.onEraseBegin();
      this.events.onEraseAt(p.x, p.y);
    } else if (tool === "select") {
      this.selStart = { x: p.x, y: p.y };
      this.selection = { x: p.x, y: p.y, w: 0, h: 0 };
    } else {
      this.points.push({ ...p, time: 0 });
    }
    return true;
  }

  /** pointermove. Returns true if visible state changed. */
  move(pointerId: number, samples: GestureSample[]): boolean {
    if (pointerId !== this.pointerId || this.tool === null) return false;
    if (this.tool === "eraser") {
      for (const s of samples) this.events.onEraseAt(s.x, s.y);
      return samples.length > 0;
    }
    if (this.tool === "select") {
      const s = samples[samples.length - 1];
      const o = this.selStart;
      if (!s || !o) return false;
      this.selection = {
        x: Math.min(o.x, s.x),
        y: Math.min(o.y, s.y),
        w: Math.abs(s.x - o.x),
        h: Math.abs(s.y - o.y),
      };
      return true;
    }
    let changed = false;
    for (const s of samples) {
      const last = this.points[this.points.length - 1];
      if (last && Math.hypot(s.x - last.x, s.y - last.y) < MIN_POINT_DIST) continue;
      this.points.push({ x: s.x, y: s.y, pressure: s.pressure, time: s.stamp - this.startStamp });
      changed = true;
    }
    return changed;
  }

  /**
   * pointerup / pointercancel / lostpointercapture. Commits or discards the
   * gesture per the `kind` semantics above. Returns false if this pointer is
   * not the active one (gesture already ended).
   */
  end(pointerId: number, kind: GestureEnd): boolean {
    if (pointerId !== this.pointerId || this.tool === null) return false;
    const tool = this.tool;
    const pts = this.points.slice();
    const sel = this.selection;
    this.reset();
    const canceled = kind === "cancel";
    if (tool === "eraser") {
      this.events.onEraseEnd();
    } else if (tool === "select") {
      if (!canceled && sel && sel.w > MIN_SELECT_SIZE && sel.h > MIN_SELECT_SIZE) {
        this.events.onSelectCommit(sel);
      }
    } else if (!canceled && pts.length > 0) {
      this.events.onStrokeCommit(pts, tool);
    }
    return true;
  }

  private reset() {
    this.pointerId = null;
    this.tool = null;
    this.points.length = 0;
    this.selection = null;
    this.selStart = null;
  }
}
