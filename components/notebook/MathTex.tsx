"use client";

import { useEffect, useRef } from "react";
import katex from "katex";

/**
 * KaTeX renderer with safe settings: trust disabled (no \href, \url, \html*),
 * throwOnError off, bounded size/expansion. KaTeX builds the markup itself
 * from the LaTeX source (model text is never injected as HTML). If KaTeX
 * cannot render, the raw source is shown as plain text.
 */
export default function MathTex({ latex, display = true }: { latex: string; display?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      katex.render(latex, el, {
        displayMode: display,
        trust: false,
        throwOnError: false,
        strict: "ignore",
        maxSize: 20,
        maxExpand: 200,
        output: "htmlAndMathml",
      });
    } catch {
      el.textContent = latex; // plain-text fallback
    }
  }, [latex, display]);

  // No React children: the node's content is owned by the effect above.
  return <span ref={ref} className="block max-w-full overflow-x-auto text-xs" aria-label={latex} />;
}
