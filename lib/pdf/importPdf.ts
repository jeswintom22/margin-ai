import type { PageBackground } from "@/lib/document/types";
import { PAGE_WIDTH } from "@/lib/document/types";
import { MAX_BACKGROUND_CHARS } from "@/lib/document/schema";

/**
 * PDF homework import (client only). Each PDF page is rendered to a JPEG at
 * 2× notebook width and becomes a locked page background. pdf.js is loaded
 * lazily and runs in its own module worker (bundled by Turbopack via
 * `new Worker(new URL(..., import.meta.url))`).
 */

export const PDF_LIMITS = { maxBytes: 25 * 1024 * 1024, maxPages: 30, renderWidth: PAGE_WIDTH * 2, jpegQuality: 0.85 } as const;

export class PdfImportError extends Error {}

/** Minimal slice of the pdf.js API we use (keeps tests free of pdf.js). */
export type PdfPageLike = {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number }; canvas: HTMLCanvasElement }): { promise: Promise<void> };
  cleanup?(): void;
};
export type PdfDocLike = { numPages: number; getPage(n: number): Promise<PdfPageLike>; destroy?(): Promise<void> };
export type PdfLoader = (data: Uint8Array) => Promise<PdfDocLike>;
export type ImportedPdfPage = { title: string; width: number; height: number; background: PageBackground };

/** Default loader: lazy pdf.js with a bundled module worker. */
export const loadWithPdfJs: PdfLoader = async (data) => {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
  }
  try {
    return (await pdfjs.getDocument({ data }).promise) as unknown as PdfDocLike;
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "PasswordException") throw new PdfImportError("This PDF is password-protected. Remove the password and try again.");
    if (name === "InvalidPDFException") throw new PdfImportError("This file is not a valid PDF or is corrupted.");
    throw new PdfImportError("The PDF could not be opened.");
  }
};

export async function readPdfFile(file: { size: number; arrayBuffer(): Promise<ArrayBuffer> }): Promise<Uint8Array> {
  if (file.size > PDF_LIMITS.maxBytes) throw new PdfImportError(`PDF is too large (max ${PDF_LIMITS.maxBytes / 1024 / 1024} MB).`);
  const data = new Uint8Array(await file.arrayBuffer());
  // "%PDF-" magic bytes: reject renamed non-PDF files before pdf.js sees them.
  if (data.length < 5 || String.fromCharCode(...data.slice(0, 5)) !== "%PDF-") throw new PdfImportError("This file is not a PDF.");
  return data;
}

/**
 * Render every page to a background. Fails as a whole (no partial import) if
 * the page limit is exceeded or any page cannot be rendered.
 */
export async function pdfToPages(
  data: Uint8Array,
  opts: { name?: string; loader?: PdfLoader; createCanvas?: () => HTMLCanvasElement } = {}
): Promise<ImportedPdfPage[]> {
  const doc = await (opts.loader ?? loadWithPdfJs)(data);
  try {
    if (doc.numPages < 1) throw new PdfImportError("The PDF has no pages.");
    if (doc.numPages > PDF_LIMITS.maxPages) throw new PdfImportError(`The PDF has ${doc.numPages} pages; the limit is ${PDF_LIMITS.maxPages}.`);
    const out: ImportedPdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: PDF_LIMITS.renderWidth / base.width });
      const canvas = (opts.createCanvas ?? (() => document.createElement("canvas")))();
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new PdfImportError("Canvas rendering is unavailable.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const dataUrl = canvas.toDataURL("image/jpeg", PDF_LIMITS.jpegQuality);
      page.cleanup?.();
      if (dataUrl.length > MAX_BACKGROUND_CHARS) throw new PdfImportError(`Page ${n} is too large to import.`);
      out.push({
        title: `${opts.name ?? "PDF"} p.${n}`.slice(0, 80),
        width: PAGE_WIDTH,
        height: Math.round((PAGE_WIDTH * base.height) / base.width),
        background: { dataUrl, width: canvas.width, height: canvas.height, label: opts.name?.slice(0, 200) },
      });
    }
    return out;
  } finally {
    await doc.destroy?.();
  }
}
