"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@/lib/engine/Editor";
import type { AssetCache } from "@/lib/engine/render/assets";
import { useEditorUI } from "@/hooks/useEditor";
import {
  computeLayout, fitWidthScale, fitPageScale, zoomToScale, scaleToZoom, clampScale, visiblePages, centerPage,
  pageAt, toPagePoint, anchoredScroll, PAGE_GAP, type Layout,
} from "@/lib/engine/layout";
import { PointerRouter, type RouterInput, type RouterSink } from "@/lib/engine/input";
import { drawStroke } from "@/lib/engine/render/elements";
import { paperColor } from "@/lib/engine/render/background";
import PageCanvas from "./PageCanvas";

const RERASTER_MS = 150;

function toInput(e: PointerEvent | React.PointerEvent): RouterInput {
  return {
    id: e.pointerId,
    type: (e.pointerType === "pen" || e.pointerType === "touch" ? e.pointerType : "mouse") as RouterInput["type"],
    button: e.button,
    buttons: e.buttons,
    x: e.clientX,
    y: e.clientY,
    pressure: e.pressure,
    time: e.timeStamp,
  };
}

/**
 * The scrollable page area: continuous layout of all pages, virtualized to
 * the viewport, with a shared overlay canvas for in-progress ink and the
 * PointerRouter deciding draw / pan / pinch.
 */
export default function Workspace({ editor, assets }: { editor: Editor; assets: AssetCache }) {
  const rev = useEditorUI(editor, (u) => u.rev);
  const mode = useEditorUI(editor, (u) => u.layout);
  const zoomMode = useEditorUI(editor, (u) => u.zoomMode);
  const zoom = useEditorUI(editor, (u) => u.zoom);
  const tool = useEditorUI(editor, (u) => u.tool);
  const currentPageId = useEditorUI(editor, (u) => u.currentPageId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [scroll, setScroll] = useState({ left: 0, top: 0 });

  const pages = editor.doc.pages;
  const current = pages.find((p) => p.id === currentPageId) ?? pages[0];
  const scale =
    vp.w === 0
      ? zoomToScale(1)
      : clampScale(
          zoomMode === "fitWidth"
            ? fitWidthScale(pages, mode, vp.w)
            : zoomMode === "fitPage"
              ? fitPageScale(current, vp.w, vp.h, mode)
              : zoomToScale(zoom)
        );

  // Pages mutate in place, so the layout is keyed on their sizes (recomputed each render, cheap).
  void rev;
  const sizesKey = pages.map((p) => `${p.width}x${p.height}`).join(",");
  const layout: Layout = useMemo(
    () => computeLayout(sizesKey.split(",").map((s) => { const [w, h] = s.split("x").map(Number); return { width: w, height: h }; }), mode, scale, vp.w),
    [sizesKey, mode, scale, vp.w]
  );

  // Debounced raster scale: canvases stretch via CSS while zoom changes.
  const [renderScale, setRenderScale] = useState(scale);
  useEffect(() => {
    if (renderScale === scale) return;
    const t = setTimeout(() => setRenderScale(scale), RERASTER_MS);
    return () => clearTimeout(t);
  }, [scale, renderScale]);

  const visible = useMemo(
    () => visiblePages(layout, { left: scroll.left, top: scroll.top, width: vp.w, height: vp.h }, vp.h),
    [layout, scroll, vp]
  );

  // Latest values for event handlers (updated after commit, not during render).
  const live = useRef({ layout, scale, editor });
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    live.current = { layout, scale, editor };
    editor.reportZoom(scaleToZoom(scale));
    const el = scrollRef.current;
    if (el && pendingScroll.current) {
      el.scrollLeft = pendingScroll.current.left;
      el.scrollTop = pendingScroll.current.top;
      pendingScroll.current = null;
    }
  }, [layout, scale, editor]);

  // Viewport size
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scroll → virtualization + current page
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setScroll({ left: el.scrollLeft, top: el.scrollTop });
        const { layout: l, editor: ed } = live.current;
        const i = centerPage(l, { left: el.scrollLeft, top: el.scrollTop, width: el.clientWidth, height: el.clientHeight });
        const p = ed.doc.pages[i];
        if (p) ed.setCurrentPage(p.id);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Bring the current page into view when it changes by navigation (not scrolling).
  useEffect(() => {
    const el = scrollRef.current;
    const i = editor.doc.pages.findIndex((p) => p.id === currentPageId);
    const b = layout.boxes[i];
    if (!el || !b) return;
    const visibleNow = b.y + b.h > el.scrollTop && b.y < el.scrollTop + el.clientHeight && b.x + b.w > el.scrollLeft && b.x < el.scrollLeft + el.clientWidth;
    if (!visibleNow) el.scrollTo({ left: Math.max(0, b.x - PAGE_GAP), top: Math.max(0, b.y - PAGE_GAP) });
  }, [currentPageId, layout, editor]);

  // ---- zoom (pinch / ctrl+wheel) anchored at a client point ----
  const zoomBy = useRef((factor: number, clientX: number, clientY: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const { layout: before, scale: s, editor: ed } = live.current;
    const next = clampScale(s * factor);
    if (next === s) return;
    const rect = el.getBoundingClientRect();
    const after = computeLayout(ed.doc.pages, ed.ui.layout, next, el.clientWidth);
    pendingScroll.current = anchoredScroll(before, after, { left: el.scrollLeft, top: el.scrollTop, width: el.clientWidth, height: el.clientHeight }, clientX - rect.left, clientY - rect.top);
    ed.setZoom("custom", scaleToZoom(next));
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return; // plain wheel scrolls natively
      e.preventDefault();
      zoomBy.current(Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---- overlay: live ink preview ----
  const overlayRaf = useRef(0);
  const drawOverlay = useRef(() => {
    const c = overlayRef.current;
    const el = scrollRef.current;
    if (!c || !el) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(el.clientWidth * dpr), h = Math.round(el.clientHeight * dpr);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const { editor: ed, layout: l } = live.current;
    const lp = ed.livePreview;
    if (!lp || !lp.preview) return;
    const i = ed.doc.pages.findIndex((p) => p.id === lp.pageId);
    const b = l.boxes[i];
    if (!b) return;
    ctx.setTransform(dpr * l.scale, 0, 0, dpr * l.scale, dpr * (b.x - el.scrollLeft), dpr * (b.y - el.scrollTop));
    const pv = lp.preview;
    if (pv.kind === "stroke") drawStroke(ctx, pv.stroke, paperColor(ed.doc.pages[i]));
    else {
      ctx.strokeStyle = "rgba(37,99,235,0.8)";
      ctx.fillStyle = "rgba(37,99,235,0.08)";
      ctx.lineWidth = 1 / l.scale;
      ctx.beginPath();
      ctx.arc(pv.x, pv.y, pv.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  });
  const loopOverlay = useRef(() => {
    drawOverlay.current();
    overlayRaf.current = requestAnimationFrame(loopOverlay.current);
  });

  // ---- pointer routing ----
  const gesturePage = useRef(-1);
  const routerRef = useRef<PointerRouter | null>(null);
  useEffect(() => {
    const toContent = (e: RouterInput) => {
      const el = scrollRef.current!;
      const r = el.getBoundingClientRect();
      return { x: e.x - r.left + el.scrollLeft, y: e.y - r.top + el.scrollTop };
    };
    const sample = (e: RouterInput) => {
      const c = toContent(e);
      const pt = toPagePoint(live.current.layout, gesturePage.current, c.x, c.y);
      return { x: pt.x, y: pt.y, pressure: e.type === "pen" && e.pressure > 0 ? e.pressure : undefined };
    };
    const sink: RouterSink = {
      toolBegin: (tool, e) => {
        const c = toContent(e);
        const i = pageAt(live.current.layout, c.x, c.y, tool === "eraser" ? 8 : 0);
        if (i < 0) return false;
        gesturePage.current = i;
        const ed = live.current.editor;
        if (!ed.beginGesture(tool, ed.doc.pages[i].id, sample(e))) return false;
        cancelAnimationFrame(overlayRaf.current);
        overlayRaf.current = requestAnimationFrame(loopOverlay.current);
        return true;
      },
      toolMove: (e) => live.current.editor.moveGesture([sample(e)]),
      toolEnd: (_e, canceled) => {
        live.current.editor.endGesture(canceled);
        cancelAnimationFrame(overlayRaf.current);
        overlayRaf.current = 0;
        drawOverlay.current();
      },
      pan: (dx, dy) => scrollRef.current?.scrollBy(dx, dy),
      pinch: (f, cx, cy) => zoomBy.current(f, cx, cy),
    };
    const router = new PointerRouter(sink, editor.inputSettings);
    routerRef.current = router;
    const off = editor.subscribe(() => router.setSettings(editor.inputSettings));
    const reset = () => router.reset();
    window.addEventListener("blur", reset);
    const raf = overlayRaf;
    return () => {
      off();
      window.removeEventListener("blur", reset);
      router.reset();
      routerRef.current = null;
      cancelAnimationFrame(raf.current);
    };
  }, [editor]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (routerRef.current?.down(toInput(e))) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Capture is best-effort (synthetic pointers have no active capture target).
      }
      e.preventDefault();
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = routerRef.current;
    if (!r) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    if (events.length > 1) for (const ev of events) r.move(toInput(ev));
    else r.move(toInput(e));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => routerRef.current?.up(toInput(e));
  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => routerRef.current?.up(toInput(e), true);

  const cursor = tool === "hand" ? "grab" : tool === "eraser" ? "cell" : "crosshair";

  return (
    <div className="relative h-full w-full">
      <div
        ref={scrollRef}
        data-testid="workspace"
        className="absolute inset-0 overflow-auto bg-[#d9d8d4] select-none"
        style={{ touchAction: "none", cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="relative" style={{ width: layout.width, height: layout.height }}>
          {visible.map((i) => (
            <PageCanvas key={pages[i].id} editor={editor} page={pages[i]} index={i} box={layout.boxes[i]} renderScale={renderScale} assets={assets} />
          ))}
          <canvas
            ref={overlayRef}
            aria-hidden
            className="pointer-events-none absolute"
            style={{ left: scroll.left, top: scroll.top, width: vp.w, height: vp.h }}
          />
        </div>
      </div>
      <ZoomControl editor={editor} scale={scale} />
    </div>
  );
}

function ZoomControl({ editor, scale }: { editor: Editor; scale: number }) {
  const pct = Math.round(scaleToZoom(scale) * 100);
  const btn = "h-8 px-2 text-xs hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none";
  return (
    <div role="group" aria-label="Zoom" className="absolute bottom-3 left-3 z-10 flex items-center overflow-hidden rounded-lg border border-neutral-300 bg-white/90 text-neutral-700 shadow-sm backdrop-blur">
      <button type="button" aria-label="Zoom out" className={btn} onClick={() => editor.setZoom("custom", scaleToZoom(clampScale(scale / 1.2)))}>−</button>
      <button type="button" aria-label="Zoom 100%" title="Zoom 100%" className={`${btn} min-w-14 border-x border-neutral-200 tabular-nums`} onClick={() => editor.setZoom("custom", 1)} data-testid="zoom-level">{pct}%</button>
      <button type="button" aria-label="Zoom in" className={btn} onClick={() => editor.setZoom("custom", scaleToZoom(clampScale(scale * 1.2)))}>+</button>
      <button type="button" aria-label="Fit page width" title="Fit width" className={`${btn} border-l border-neutral-200`} onClick={() => editor.setZoom("fitWidth")}>↔</button>
    </div>
  );
}
