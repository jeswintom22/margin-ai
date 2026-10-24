"use client";

import { useEffect, useRef, useCallback } from "react";
import type { NotebookPage, Point, Stroke } from "@/lib/document/types";
import { renderPage } from "@/lib/drawing/render";
import { clientToPage, fitScale } from "@/lib/drawing/coords";
import { CanvasGesture } from "@/lib/drawing/gesture";
import type { EditorTool } from "@/lib/document/types";
import type { Rect } from "@/lib/drawing/geometry";

type Props = {
  page: NotebookPage;
  tool: EditorTool;
  color: string;
  strokeWidth: number;
  /** Bump to force a repaint after external doc mutation (undo, erase, etc). */
  version: number;
  selectedIds: string[];
  onCommitStroke: (points: Point[]) => void;
  onEraseBegin: () => void;
  onEraseAt: (x: number, y: number, radius: number) => boolean;
  onEraseEnd: () => void;
  onSelectRect: (rect: Rect) => void;
};

const ERASER_RADIUS = 14;

/**
 * Drawing surface. Pointer lifecycle lives in a CanvasGesture state machine;
 * the in-progress stroke is repainted on a rAF loop only while drawing, so
 * React never re-renders per pointermove.
 */
export default function PaperCanvas({
  page, tool, color, strokeWidth, version, selectedIds,
  onCommitStroke, onEraseBegin, onEraseAt, onEraseEnd, onSelectRect,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const dirty = useRef(true);

  // Latest callbacks, read by the gesture's event handlers at event time.
  const handlers = useRef({ onCommitStroke, onEraseBegin, onEraseAt, onEraseEnd, onSelectRect });
  useEffect(() => {
    handlers.current = { onCommitStroke, onEraseBegin, onEraseAt, onEraseEnd, onSelectRect };
  }, [onCommitStroke, onEraseBegin, onEraseAt, onEraseEnd, onSelectRect]);

  // Created on mount (before any pointer input can arrive); never read during render.
  const gestureRef = useRef<CanvasGesture | null>(null);
  useEffect(() => {
    gestureRef.current = new CanvasGesture({
      onStrokeCommit: (pts) => handlers.current.onCommitStroke(pts),
      onEraseBegin: () => handlers.current.onEraseBegin(),
      onEraseAt: (x, y) => handlers.current.onEraseAt(x, y, ERASER_RADIUS),
      onEraseEnd: () => handlers.current.onEraseEnd(),
      onSelectCommit: (r) => handlers.current.onSelectRect(r),
    });
  }, []);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const widthRef = useRef(strokeWidth);
  useEffect(() => {
    toolRef.current = tool;
    colorRef.current = color;
    widthRef.current = strokeWidth;
  }, [tool, color, strokeWidth]);

  const scaleRef = useRef(1);

  // Keep canvas backing store sized to element × DPR. Page is rendered at a
  // scale that fits the wrapper width (with a minimum so it stays usable).
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = wrap.clientWidth;
    const cssH = wrap.clientHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    scaleRef.current = fitScale(cssW, cssH, page.width, page.height, cssW < 640 ? 0.98 : 0.92);
    dirty.current = true;
  }, [page.width, page.height]);

  const toPage = useCallback((clientX: number, clientY: number): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return clientToPage(clientX, clientY, rect, page.width, page.height, scaleRef.current);
  }, [page.width, page.height]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const scale = scaleRef.current;
    const offsetX = (canvas.width / dpr - page.width * scale) / 2;
    const offsetY = (canvas.height / dpr - page.height * scale) / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // page shadow backdrop
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(offsetX + 4, offsetY + 6, page.width * scale, page.height * scale);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY);

    let inProgress: Stroke | null = null;
    const gesture = gestureRef.current;
    const gtool = gesture?.activeTool;
    if (gesture?.drawingStroke && gesture.points.length > 0 && (gtool === "pen" || gtool === "highlighter")) {
      inProgress = {
        id: "__live__",
        points: gesture.points,
        color: colorRef.current,
        width: gtool === "highlighter" ? widthRef.current * 4 : widthRef.current,
        tool: gtool,
        author: "user",
      };
    }
    renderPage(ctx, page, inProgress);

    // selection highlights
    if (selectedIds.length) {
      ctx.save();
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 1.5 / scale;
      ctx.setLineDash([6 / scale, 4 / scale]);
      for (const layer of page.layers) {
        for (const s of layer.strokes) {
          if (!selectedIds.includes(s.id)) continue;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const p of s.points) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
          }
          const pad = s.width / 2 + 4;
          ctx.strokeRect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);
        }
      }
      ctx.restore();
    }

    // in-progress selection rect
    const r = gesture?.selection;
    if (r) {
      ctx.save();
      ctx.fillStyle = "rgba(59,130,246,0.08)";
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 1 / scale;
      ctx.setLineDash([5 / scale, 4 / scale]);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }
  }, [page, selectedIds]);

  // rAF loop: repaint when dirty (drawing, resize, doc change)
  useEffect(() => {
    const loop = () => {
      if (dirty.current) {
        dirty.current = false;
        paint();
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [paint]);

  useEffect(() => {
    dirty.current = true;
  }, [version, page, selectedIds]);

  // Repaint once the handwriting font is ready so AI text uses it.
  useEffect(() => {
    document.fonts?.load('16px Kalam').then(() => { dirty.current = true; }).catch(() => {});
  }, []);

  useEffect(() => {
    resize();
    const ro = new ResizeObserver(() => {
      resize();
    });
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [resize]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const p = toPage(e.clientX, e.clientY);
    if (e.pointerType === "pen") p.pressure = e.pressure || 0.5;
    // Ignored if another gesture is already active (e.g. a resting palm).
    if (!gestureRef.current?.begin(toolRef.current, e.pointerId, p, e.nativeEvent.timeStamp)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dirty.current = true;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Coalesced events give every sub-frame position for smooth input.
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    const samples = events.map((ev) => {
      const p = toPage(ev.clientX, ev.clientY);
      return {
        x: p.x,
        y: p.y,
        pressure: ev.pointerType === "pen" ? ev.pressure || 0.5 : undefined,
        stamp: ev.timeStamp,
      };
    });
    if (gestureRef.current?.move(e.pointerId, samples)) dirty.current = true;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (gestureRef.current?.end(e.pointerId, "up")) dirty.current = true;
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (gestureRef.current?.end(e.pointerId, "cancel")) dirty.current = true;
  };

  // Fired automatically after pointerup (no-op then) and when capture is lost
  // without pointerup (commits the finished gesture instead of dropping it).
  const onLostPointerCapture = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (gestureRef.current?.end(e.pointerId, "lostCapture")) dirty.current = true;
  };

  return (
    <div ref={wrapRef} className="h-full w-full overflow-hidden bg-neutral-200">
      <canvas
        ref={canvasRef}
        className="block"
        style={{
          touchAction: "none",
          cursor:
            tool === "eraser" ? "cell" : tool === "select" ? "crosshair" : "crosshair",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onLostPointerCapture}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Notebook page canvas"
      />
    </div>
  );
}
