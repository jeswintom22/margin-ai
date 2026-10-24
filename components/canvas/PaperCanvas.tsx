"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { NotebookPage, Point, Stroke } from "@/lib/document/types";
import { onBackgroundLoaded, renderPage } from "@/lib/drawing/render";
import { clientToPage, fitWidthScale, maxScroll, pageOffset, PAGE_GAP } from "@/lib/drawing/coords";
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
  onSelectLasso: (poly: Point[]) => void;
};

const ERASER_RADIUS = 14;

/**
 * Drawing surface. Pointer lifecycle lives in a CanvasGesture state machine;
 * the in-progress stroke is repainted on a rAF loop only while drawing, so
 * React never re-renders per pointermove.
 */
export default function PaperCanvas({
  page, tool, color, strokeWidth, version, selectedIds,
  onCommitStroke, onEraseBegin, onEraseAt, onEraseEnd, onSelectRect, onSelectLasso,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const dirty = useRef(true);

  // Latest callbacks, read by the gesture's event handlers at event time.
  const handlers = useRef({ onCommitStroke, onEraseBegin, onEraseAt, onEraseEnd, onSelectRect, onSelectLasso });
  useEffect(() => {
    handlers.current = { onCommitStroke, onEraseBegin, onEraseAt, onEraseEnd, onSelectRect, onSelectLasso };
  }, [onCommitStroke, onEraseBegin, onEraseAt, onEraseEnd, onSelectRect, onSelectLasso]);

  // Created on mount (before any pointer input can arrive); never read during render.
  const gestureRef = useRef<CanvasGesture | null>(null);
  useEffect(() => {
    gestureRef.current = new CanvasGesture({
      onStrokeCommit: (pts) => handlers.current.onCommitStroke(pts),
      onEraseBegin: () => handlers.current.onEraseBegin(),
      onEraseAt: (x, y) => handlers.current.onEraseAt(x, y, ERASER_RADIUS),
      onEraseEnd: () => handlers.current.onEraseEnd(),
      onSelectCommit: (r) => handlers.current.onSelectRect(r),
      onLassoCommit: (poly) => handlers.current.onSelectLasso(poly),
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
  /** Zoom multiplier over fit-to-width (1 = page width fills the view). */
  const zoomRef = useRef(1);
  const scrollRef = useRef(0);
  const [zoomPct, setZoomPct] = useState(100);

  const clampScroll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const h = canvas.clientHeight;
    scrollRef.current = Math.min(Math.max(0, scrollRef.current), maxScroll(h, page.height, scaleRef.current));
  }, [page.height]);

  // Keep canvas backing store sized to element × DPR. The page fills the
  // view width (Xournal++-style) and scrolls vertically; zoom scales that.
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
    scaleRef.current = fitWidthScale(cssW, page.width, cssW < 640 ? 1 : 1.25) * zoomRef.current;
    clampScroll();
    dirty.current = true;
  }, [page.width, clampScroll]);

  /** Set zoom, keeping the page point under (clientY) fixed on screen. */
  const setZoom = useCallback((z: number, anchorClientY?: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const before = scaleRef.current;
    const ay = anchorClientY ?? rect.top + rect.height / 2;
    const docY = clientToPage(0, ay, rect, page.width, page.height, before, scrollRef.current).y;
    zoomRef.current = Math.min(3, Math.max(0.5, z));
    resize();
    const after = scaleRef.current;
    // Keep docY at the same screen position (only matters when scrolling).
    scrollRef.current = PAGE_GAP + docY * after - (ay - rect.top);
    clampScroll();
    setZoomPct(Math.round(zoomRef.current * 100));
    dirty.current = true;
  }, [page.width, page.height, resize, clampScroll]);

  const toPage = useCallback((clientX: number, clientY: number): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return clientToPage(clientX, clientY, rect, page.width, page.height, scaleRef.current, scrollRef.current);
  }, [page.width, page.height]);

  // Wheel scrolls the page; Ctrl/⌘+wheel zooms. Native listener: React's
  // onWheel is passive and can't preventDefault the browser zoom.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        setZoom(zoomRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientY);
        return;
      }
      scrollRef.current += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      clampScroll();
      dirty.current = true;
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [setZoom, clampScroll]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const scale = scaleRef.current;
    const { x: offsetX, y: offsetY } = pageOffset(canvas.width / dpr, canvas.height / dpr, page.width, page.height, scale, scrollRef.current);
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

    // in-progress lasso loop
    if (gesture?.active && gesture.activeTool === "lasso" && gesture.points.length > 1) {
      ctx.save();
      ctx.strokeStyle = "#3b82f6";
      ctx.fillStyle = "rgba(59,130,246,0.06)";
      ctx.lineWidth = 1.5 / scale;
      ctx.setLineDash([6 / scale, 4 / scale]);
      ctx.beginPath();
      gesture.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
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

  // Repaint when a page background (imported PDF) finishes decoding.
  useEffect(() => onBackgroundLoaded(() => { dirty.current = true; }), []);

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
    // Ink only starts on the paper; selection/eraser may start anywhere.
    const inking = toolRef.current === "pen" || toolRef.current === "highlighter";
    if (inking && (p.x < 0 || p.y < 0 || p.x > page.width || p.y > page.height)) return;
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
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-[#e7e5e4]">
      <div className="absolute bottom-4 left-4 z-10 flex items-center overflow-hidden rounded-md border border-neutral-300 bg-white text-xs text-neutral-700 shadow-sm" role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom out" title="Zoom out (Ctrl+wheel)" onClick={() => setZoom(zoomRef.current / 1.2)}
          className="h-7 w-7 hover:bg-neutral-100">−</button>
        <button type="button" aria-label="Fit page width" title="Fit page width" onClick={() => { scrollRef.current = 0; setZoom(1); }}
          className="h-7 min-w-12 border-x border-neutral-200 px-1.5 tabular-nums hover:bg-neutral-100">{zoomPct}%</button>
        <button type="button" aria-label="Zoom in" title="Zoom in (Ctrl+wheel)" onClick={() => setZoom(zoomRef.current * 1.2)}
          className="h-7 w-7 hover:bg-neutral-100">+</button>
      </div>
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
        data-user-strokes={page.layers.filter((l) => l.author === "user").reduce((n, l) => n + l.strokes.length, 0)}
        data-ai-elements={page.layers.filter((l) => l.author === "ai").reduce((n, l) => n + l.elements.length, 0)}
        data-ai-visible={String(page.layers.find((l) => l.author === "ai")?.visible ?? true)}
        data-has-background={String(!!page.background)}
      />
    </div>
  );
}
