"use client";

import { useEffect, useRef } from "react";
import type { Editor } from "@/lib/engine/Editor";
import type { AssetCache } from "@/lib/engine/render/assets";
import { renderPage } from "@/lib/engine/render/elements";
import type { PageBox } from "@/lib/engine/layout";
import type { Page } from "@/lib/xdoc/types";

/** Browsers cap canvas area (~16.7M px on iOS); stay under it. */
const MAX_CANVAS_PIXELS = 16_000_000;

/**
 * One page's committed content. Repaints only when its page is invalidated,
 * an asset finishes loading, or the render scale changes. While zooming the
 * element is CSS-stretched to `box` and re-rasterized once `renderScale`
 * settles.
 */
export default function PageCanvas({
  editor, page, index, box, renderScale, assets,
}: {
  editor: Editor;
  page: Page;
  index: number;
  box: PageBox;
  renderScale: number;
  assets: AssetCache;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let raf = 0;
    const paint = () => {
      raf = 0;
      const dpr = window.devicePixelRatio || 1;
      let k = renderScale * dpr;
      const area = page.width * page.height * k * k;
      if (area > MAX_CANVAS_PIXELS) k *= Math.sqrt(MAX_CANVAS_PIXELS / area);
      const w = Math.max(1, Math.round(page.width * k));
      const h = Math.max(1, Math.round(page.height * k));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      renderPage(ctx, page, { assets });
      canvas.dataset.elements = String(page.layers.reduce((n, l) => n + l.elements.length, 0));
      canvas.dataset.userElements = String(page.layers.filter((l) => l.author === "user").reduce((n, l) => n + l.elements.length, 0));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    paint();
    const offPages = editor.subscribePages((ids) => ids.has(page.id) && schedule());
    const offAssets = assets.onLoaded(schedule);
    return () => {
      offPages();
      offAssets();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [editor, page, renderScale, assets]);

  const bg = page.background;
  return (
    <canvas
      ref={ref}
      aria-label={`Page ${index + 1}`}
      data-page-index={index}
      data-page-id={page.id}
      data-background={bg.kind === "solid" ? bg.style : bg.kind}
      className="absolute block bg-white shadow-[0_1px_4px_rgba(0,0,0,0.18)]"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
    />
  );
}
