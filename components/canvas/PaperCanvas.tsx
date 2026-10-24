"use client";

import { useEffect, useRef, useCallback } from "react";
import type { NotebookPage, Point, Stroke } from "@/lib/document/types";
import { renderPage } from "@/lib/drawing/render";
import { clientToPage, fitScale } from "@/lib/drawing/coords";
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
  onEraseAt: (x: number, y: number, radius: number) => boolean;
  onSelectRect: (rect: Rect) => void;
};

const ERASER_RADIUS = 14;

/**
 * Drawing surface. Keeps the in-progress stroke in a ref and repaints on a
 * rAF loop only while drawing, so React never re-renders per pointermove.
 */
export default function PaperCanvas({
  page, tool, color, strokeWidth, version, selectedIds,
  onCommitStroke, onEraseAt, onSelectRect,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const pointerId = useRef<number | null>(null);
  const points = useRef<Point[]>([]);
  const erasedDuringDrag = useRef(false);
  const selectRect = useRef<Rect | null>(null);
  const selectStart = useRef<Point | null>(null);
  const strokeStart = useRef(0);
  const raf = useRef(0);
  const dirty = useRef(true);
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
    if (drawing.current && points.current.length > 0 && (toolRef.current === "pen" || toolRef.current === "highlighter")) {
      inProgress = {
        id: "__live__",
        points: points.current,
        color: colorRef.current,
        width: toolRef.current === "highlighter" ? widthRef.current * 4 : widthRef.current,
        tool: toolRef.current,
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
    const r = selectRect.current;
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
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerId.current = e.pointerId;
    drawing.current = true;
    erasedDuringDrag.current = false;
    const p = toPage(e.clientX, e.clientY);
    p.pressure = e.pointerType === "pen" ? e.pressure || 0.5 : undefined;
    p.time = 0;

    if (toolRef.current === "eraser") {
      onEraseAt(p.x, p.y, ERASER_RADIUS);
      erasedDuringDrag.current = true;
      dirty.current = true;
    } else if (toolRef.current === "select") {
      selectStart.current = p;
      selectRect.current = { x: p.x, y: p.y, w: 0, h: 0 };
      dirty.current = true;
    } else {
      strokeStart.current = e.nativeEvent.timeStamp;
      points.current = [p];
      dirty.current = true;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || pointerId.current !== e.pointerId) return;
    const t = toolRef.current;

    if (t === "eraser") {
      // Use coalesced events for responsive erasing.
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      for (const ev of events) {
        const p = toPage(ev.clientX, ev.clientY);
        onEraseAt(p.x, p.y, ERASER_RADIUS);
      }
      dirty.current = true;
      return;
    }
    if (t === "select") {
      const p = toPage(e.clientX, e.clientY);
      const s = selectStart.current!;
      selectRect.current = {
        x: Math.min(s.x, p.x),
        y: Math.min(s.y, p.y),
        w: Math.abs(p.x - s.x),
        h: Math.abs(p.y - s.y),
      };
      dirty.current = true;
      return;
    }

    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of events) {
      const p = toPage(ev.clientX, ev.clientY);
      // ignore tiny movements to reduce point density
      const last = points.current[points.current.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.6) continue;
      if (ev.pointerType === "pen") p.pressure = ev.pressure || 0.5;
      p.time = ev.timeStamp - strokeStart.current;
      points.current.push(p);
    }
    dirty.current = true;
  };

  const endStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || pointerId.current !== e.pointerId) return;
    drawing.current = false;
    pointerId.current = null;
    const t = toolRef.current;
    if (t === "pen" || t === "highlighter") {
      const pts = points.current;
      points.current = [];
      if (pts.length) onCommitStroke(pts);
    } else if (t === "select") {
      const r = selectRect.current;
      selectRect.current = null;
      selectStart.current = null;
      if (r && r.w > 2 && r.h > 2) onSelectRect(r);
    }
    dirty.current = true;
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
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Notebook page canvas"
      />
    </div>
  );
}
