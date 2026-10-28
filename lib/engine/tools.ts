import type { Element, LineStyle, Page, Point, Stroke } from "@/lib/xdoc/types";
import { drawLayer, newId } from "@/lib/xdoc/factories";
import { InsertElements, SetLayerElements, type Command } from "./history";
import { simplify, splitStrokeByCircle, strokeHitsPoint } from "./geometry";

export type EraserMode = "standard" | "whiteout" | "stroke";
export type EraserSize = "fine" | "medium" | "thick";
/** Eraser radius in points per size. */
export const ERASER_RADIUS: Record<EraserSize, number> = { fine: 3, medium: 7, thick: 14 };

export type ToolSettings = {
  color: string;
  penWidth: number;
  highlighterWidth: number;
  lineStyle: LineStyle;
  fill: boolean;
  eraserMode: EraserMode;
  eraserSize: EraserSize;
  pressure: boolean;
};

export const PEN_WIDTHS = { fine: 0.85, medium: 1.41, thick: 2.26 } as const; // Xournal++ defaults (pt)
export const HIGHLIGHTER_WIDTHS = { fine: 2.83, medium: 8.5, thick: 19.84 } as const;

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  color: "#000000",
  penWidth: PEN_WIDTHS.medium,
  highlighterWidth: HIGHLIGHTER_WIDTHS.medium,
  lineStyle: "plain",
  fill: false,
  eraserMode: "standard",
  eraserSize: "medium",
  pressure: true,
};

/** Tool sample in page points. `pressure` is 0..1 or undefined (mouse/touch). */
export type Sample = { x: number; y: number; pressure?: number };

/** What the overlay should draw for the gesture in progress. */
export type LivePreview = { kind: "stroke"; stroke: Stroke } | { kind: "eraser"; x: number; y: number; r: number } | null;

export interface Gesture {
  readonly pageId: string;
  move(samples: Sample[]): void;
  /** Finish; returns the command to record (already applied for in-place tools). */
  end(canceled: boolean): { command: Command | null; applied: boolean };
  preview(): LivePreview;
  /** Pages whose committed content changed during the gesture (live erasing). */
  dirtyPages(): string[];
}

const MIN_DIST = 0.25; // pt; drops sub-pixel jitter
export const pressureWidth = (w: number, p: number) => w * (0.4 + 1.2 * p);

/** Pen / highlighter / whiteout ink. Committed as one InsertElements on end. */
export class InkGesture implements Gesture {
  private stroke: Stroke;
  private usePressure: boolean;
  constructor(readonly pageId: string, private layerId: string, opts: { tool: Stroke["tool"]; color: string; width: number; lineStyle?: LineStyle; fill?: string; pressure: boolean }, first: Sample) {
    this.usePressure = opts.pressure && first.pressure !== undefined && opts.tool === "pen";
    this.stroke = {
      id: newId(),
      type: "stroke",
      tool: opts.tool,
      color: opts.color,
      width: opts.width,
      points: [{ x: first.x, y: first.y }],
      ...(this.usePressure ? { widths: [pressureWidth(opts.width, first.pressure!)] } : {}),
      ...(opts.lineStyle && opts.lineStyle !== "plain" ? { lineStyle: opts.lineStyle } : {}),
      ...(opts.fill ? { fill: opts.fill } : {}),
    };
  }
  move(samples: Sample[]) {
    const s = this.stroke;
    for (const p of samples) {
      const last = s.points[s.points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < MIN_DIST) continue;
      s.points.push({ x: p.x, y: p.y });
      if (s.widths) s.widths.push(pressureWidth(s.width, p.pressure ?? 0.5));
    }
  }
  end(canceled: boolean) {
    if (canceled) return { command: null, applied: false };
    const s = this.stroke;
    const simp = simplify(s.points, s.widths, 0.12);
    const final: Stroke = { ...s, points: simp.points, ...(simp.widths ? { widths: simp.widths } : {}) };
    return { command: new InsertElements([{ pageId: this.pageId, layerId: this.layerId, index: Number.MAX_SAFE_INTEGER, element: final }], "Draw"), applied: false };
  }
  preview(): LivePreview {
    return { kind: "stroke", stroke: this.stroke };
  }
  dirtyPages() {
    return [];
  }
}

/**
 * Standard (split) and delete-stroke erasers work on strokes of every
 * visible layer of the page, applied live so the user sees the result; the
 * whole drag is one undo step (SetLayerElements per touched layer).
 */
export class EraseGesture implements Gesture {
  private before = new Map<string, Element[]>();
  private last: Sample;
  constructor(readonly pageId: string, private page: Page, private mode: "standard" | "stroke", private radius: number, first: Sample) {
    this.last = first;
    this.eraseAt(first);
  }
  private eraseAt(p: Sample) {
    for (const layer of this.page.layers) {
      if (!layer.visible) continue;
      let changed = false;
      const next: Element[] = [];
      for (const e of layer.elements) {
        if (e.type !== "stroke") {
          next.push(e);
          continue;
        }
        if (this.mode === "stroke") {
          if (strokeHitsPoint(e, p.x, p.y, this.radius)) changed = true;
          else next.push(e);
          continue;
        }
        const pieces = splitStrokeByCircle(e, p.x, p.y, this.radius);
        if (!pieces) {
          next.push(e);
          continue;
        }
        changed = true;
        const { widths, ...rest } = e;
        void widths;
        for (const piece of pieces) next.push({ ...rest, id: newId(), points: piece.points, ...(piece.widths ? { widths: piece.widths } : {}) });
      }
      if (changed) {
        if (!this.before.has(layer.id)) this.before.set(layer.id, layer.elements);
        layer.elements = next;
      }
    }
  }
  move(samples: Sample[]) {
    for (const p of samples) {
      // interpolate so fast drags don't skip strokes
      const d = Math.hypot(p.x - this.last.x, p.y - this.last.y);
      const steps = Math.max(1, Math.ceil(d / (this.radius * 0.8)));
      for (let i = 1; i <= steps; i++) this.eraseAt({ x: this.last.x + ((p.x - this.last.x) * i) / steps, y: this.last.y + ((p.y - this.last.y) * i) / steps });
      this.last = p;
    }
  }
  end() {
    if (!this.before.size) return { command: null, applied: true };
    const changes = [...this.before].map(([layerId, before]) => ({
      pageId: this.pageId,
      layerId,
      before,
      after: this.page.layers.find((l) => l.id === layerId)!.elements,
    }));
    return { command: new SetLayerElements(changes, "Erase"), applied: true };
  }
  preview(): LivePreview {
    return { kind: "eraser", x: this.last.x, y: this.last.y, r: this.radius };
  }
  dirtyPages() {
    return this.before.size ? [this.pageId] : [];
  }
}

/** Create the gesture for a drawing tool on a page. */
export function startGesture(
  page: Page,
  tool: "pen" | "highlighter" | "eraser",
  settings: ToolSettings,
  layerId: string | null,
  first: Sample
): Gesture {
  if (tool === "eraser") {
    const r = ERASER_RADIUS[settings.eraserSize];
    if (settings.eraserMode === "whiteout") {
      const layer = drawLayer(page, layerId);
      return new InkGesture(page.id, layer.id, { tool: "whiteout", color: "#ffffff", width: r * 2, pressure: false }, first);
    }
    return new EraseGesture(page.id, page, settings.eraserMode, r, first);
  }
  const layer = drawLayer(page, layerId);
  const hl = tool === "highlighter";
  return new InkGesture(
    page.id,
    layer.id,
    {
      tool,
      color: settings.color,
      width: hl ? settings.highlighterWidth : settings.penWidth,
      lineStyle: hl ? undefined : settings.lineStyle,
      pressure: settings.pressure,
    },
    first
  );
}

/** Points of a polyline (for previews) in page space. */
export type { Point };
