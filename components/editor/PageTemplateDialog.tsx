"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@/lib/engine/Editor";
import { BACKGROUND_STYLES, PAPER_COLORS } from "@/lib/xdoc/templates";
import { PAGE_SIZES, PAGE_SIZE_LIMITS, type PageSizeName } from "@/lib/xdoc/units";
import type { BackgroundStyle, Page, PageTemplate } from "@/lib/xdoc/types";
import { drawBackground } from "@/lib/engine/render/background";

const MM_PER_PT = 25.4 / 72;
const toMm = (pt: number) => Math.round(pt * MM_PER_PT * 10) / 10;
const toPt = (mm: number) => mm / MM_PER_PT;

function detectSize(w: number, h: number): PageSizeName | "custom" {
  for (const [name, s] of Object.entries(PAGE_SIZES) as [PageSizeName, { width: number; height: number }][]) {
    if ((Math.abs(s.width - w) < 1 && Math.abs(s.height - h) < 1) || (Math.abs(s.width - h) < 1 && Math.abs(s.height - w) < 1)) return name;
  }
  return "custom";
}

function Preview({ style, color, selected }: { style: BackgroundStyle; color: string; selected: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = 72 * dpr;
    c.height = 96 * dpr;
    const ctx = c.getContext("2d")!;
    const k = (72 * dpr) / 200;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const page: Page = { id: "p", width: 200, height: 266, layers: [], background: { kind: "solid", style, color } };
    drawBackground(ctx, page);
  }, [style, color]);
  return <canvas ref={ref} aria-hidden className={`h-24 w-[72px] rounded-sm ${selected ? "ring-2 ring-blue-500" : "ring-1 ring-neutral-300"}`} />;
}

/**
 * Xournal++ "Page template" dialog: size, orientation, background style and
 * paper color, applied to the current page or all pages (one undo step).
 */
export default function PageTemplateDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const page = editor.currentPage;
  const solid = page.background.kind === "solid" ? page.background : null;
  const [size, setSize] = useState<PageSizeName | "custom">(detectSize(page.width, page.height));
  const [landscape, setLandscape] = useState(page.width > page.height);
  const [wMm, setWMm] = useState(toMm(Math.min(page.width, page.height)));
  const [hMm, setHMm] = useState(toMm(Math.max(page.width, page.height)));
  const [style, setStyle] = useState<BackgroundStyle>(solid?.style ?? "plain");
  const [color, setColor] = useState(solid?.color ?? "#ffffff");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>("select, button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dims = (): { width: number; height: number } => {
    const base = size === "custom" ? { width: toPt(wMm), height: toPt(hMm) } : PAGE_SIZES[size];
    const clamp = (v: number) => Math.min(PAGE_SIZE_LIMITS.max, Math.max(PAGE_SIZE_LIMITS.min, v));
    const a = clamp(Math.min(base.width, base.height)), b = clamp(Math.max(base.width, base.height));
    return landscape ? { width: b, height: a } : { width: a, height: b };
  };

  const apply = (all: boolean) => {
    const t: PageTemplate = { ...dims(), background: { kind: "solid", style, color } };
    editor.setPageTemplate(all ? editor.doc.pages.map((p) => p.id) : [page.id], t);
    onClose();
  };

  const field = "rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Page template" className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900/95 p-5 text-neutral-100 shadow-2xl backdrop-blur-xl">
        <h2 className="mb-4 text-base font-semibold">Page template</h2>

        <div className="mb-4 flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-400">Size</span>
            <select aria-label="Page size" className={`${field} text-neutral-900`} value={size} onChange={(e) => setSize(e.target.value as PageSizeName | "custom")}>
              {Object.keys(PAGE_SIZES).map((n) => <option key={n} value={n}>{n}</option>)}
              <option value="custom">Custom…</option>
            </select>
          </label>
          {size === "custom" && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-400">Width (mm)</span>
                <input aria-label="Width in millimeters" type="number" min={26} max={2100} className={`${field} w-24 text-neutral-900`} value={wMm} onChange={(e) => setWMm(Number(e.target.value))} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-400">Height (mm)</span>
                <input aria-label="Height in millimeters" type="number" min={26} max={2100} className={`${field} w-24 text-neutral-900`} value={hMm} onChange={(e) => setHMm(Number(e.target.value))} />
              </label>
            </>
          )}
          <label className="flex items-center gap-2 pb-1">
            <input type="checkbox" checked={landscape} onChange={(e) => setLandscape(e.target.checked)} />
            Landscape
          </label>
        </div>

        <fieldset className="mb-4">
          <legend className="mb-2 text-xs text-neutral-400">Background</legend>
          <div role="radiogroup" aria-label="Background style" className="grid grid-cols-4 gap-3">
            {BACKGROUND_STYLES.map((b) => (
              <button key={b.style} type="button" role="radio" aria-checked={style === b.style} aria-label={b.label} onClick={() => setStyle(b.style)} className="flex flex-col items-center gap-1 rounded-lg p-1 text-[11px] text-neutral-300 hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none">
                <Preview style={b.style} color={color} selected={style === b.style} />
                {b.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mb-5">
          <legend className="mb-2 text-xs text-neutral-400">Paper color</legend>
          <div role="radiogroup" aria-label="Paper color" className="flex flex-wrap gap-2">
            {PAPER_COLORS.map((p) => (
              <button key={p.color} type="button" role="radio" aria-checked={color === p.color} aria-label={p.label} title={p.label} onClick={() => setColor(p.color)} className={`h-7 w-7 rounded-full border ${color === p.color ? "ring-2 ring-blue-400 ring-offset-2 ring-offset-neutral-900" : "border-white/30"}`} style={{ backgroundColor: p.color }} />
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-neutral-300 hover:bg-white/10">Cancel</button>
          <button type="button" onClick={() => apply(true)} className="rounded-lg border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10">Apply to all pages</button>
          <button type="button" onClick={() => apply(false)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500">Apply to this page</button>
        </div>
      </div>
    </div>
  );
}
