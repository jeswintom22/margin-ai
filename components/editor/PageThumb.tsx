"use client";

import { useEffect, useRef } from "react";
import type { Editor } from "@/lib/engine/Editor";
import type { AssetCache } from "@/lib/engine/render/assets";
import { renderPage } from "@/lib/engine/render/elements";
import type { Page } from "@/lib/xdoc/types";

export const THUMB_WIDTH = 120;
const REPAINT_MS = 250;

/** Lazy, low-res page preview: renders only while scrolled into view. */
export default function PageThumb({ editor, page, assets }: { editor: Editor; page: Page; assets: AssetCache }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const h = Math.round((THUMB_WIDTH * page.height) / page.width);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let visible = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stale = true;
    const paint = () => {
      timer = null;
      if (!visible) return;
      stale = false;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const k = (THUMB_WIDTH / page.width) * dpr;
      c.width = Math.round(page.width * k);
      c.height = Math.round(page.height * k);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      renderPage(ctx, page, { assets });
    };
    const schedule = () => {
      stale = true;
      if (visible && !timer) timer = setTimeout(paint, REPAINT_MS);
    };
    const io = new IntersectionObserver(([en]) => {
      visible = en.isIntersecting;
      if (visible && stale) paint();
    });
    io.observe(c);
    const offPages = editor.subscribePages((ids) => ids.has(page.id) && schedule());
    const offAssets = assets.onLoaded(schedule);
    return () => {
      io.disconnect();
      offPages();
      offAssets();
      if (timer) clearTimeout(timer);
    };
  }, [editor, page, assets, h]);

  return <canvas ref={ref} aria-hidden className="block bg-white" style={{ width: THUMB_WIDTH, height: h }} />;
}
