"use client";

import type { AnswerBlock, AnswerDocument, DiagramPrimitive, ListItem } from "@/lib/ai/answerSchema";
import MathTex from "@/components/notebook/MathTex";

/**
 * Renders a validated AnswerDocument as React elements. All model text is
 * rendered as strings — never through dangerouslySetInnerHTML. LaTeX goes
 * through KaTeX (trust off) with a plain-text fallback.
 */
export default function AnswerView({ doc }: { doc: AnswerDocument }) {
  return (
    <div className="min-w-0 space-y-2 text-sm text-neutral-800">
      <h3 className="text-sm font-semibold">{doc.title}</h3>
      {doc.blocks.map((b) => (
        <BlockView key={b.id} block={b} />
      ))}
      {doc.summary && <p className="border-t border-neutral-200 pt-1.5 text-xs text-neutral-500">{doc.summary}</p>}
      {doc.followUpSuggestions && doc.followUpSuggestions.length > 0 && (
        <ul className="space-y-0.5">
          {doc.followUpSuggestions.map((s, i) => (
            <li key={i} className="text-xs text-blue-700">{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BlockView({ block }: { block: AnswerBlock }) {
  switch (block.type) {
    case "paragraph":
      return <p className="whitespace-pre-wrap break-words">{block.text}</p>;

    case "heading": {
      const cls =
        block.level === 1
          ? "text-base font-bold"
          : block.level === 2
            ? "text-sm font-bold"
            : "text-sm font-semibold";
      return <p className={`${cls} break-words`}>{block.text}</p>;
    }

    case "list":
      return <List items={block.items} numbered={block.style === "numbered"} />;

    case "callout":
      return (
        <div
          className={`rounded-md border-l-4 px-2 py-1.5 text-sm ${
            block.kind === "warning"
              ? "border-amber-400 bg-amber-50 text-amber-900"
              : block.kind === "tip"
                ? "border-green-500 bg-green-50 text-green-900"
                : "border-blue-400 bg-blue-50 text-blue-900"
          }`}
        >
          <span className="mr-1 font-medium uppercase text-[10px]">{block.kind}</span>
          {block.text}
        </div>
      );

    case "math":
      return (
        <div className="rounded-md bg-neutral-50 px-2 py-1.5 text-center">
          <MathTex latex={block.latex} display={block.display} />
        </div>
      );

    case "derivation":
      return (
        <ol className="space-y-1">
          {block.steps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-0.5 shrink-0 text-xs text-neutral-400">{i + 1}.</span>
              <div className="min-w-0">
                <div className="rounded bg-neutral-50 px-2 py-1">
                  <MathTex latex={s.latex} />
                </div>
                {s.note && <p className="mt-0.5 text-xs text-neutral-500">{s.note}</p>}
              </div>
            </li>
          ))}
        </ol>
      );

    case "definition":
      return (
        <p className="break-words">
          <span className="font-semibold">{block.term}</span>
          <span className="text-neutral-500"> — </span>
          {block.definition}
        </p>
      );

    case "code":
      return (
        <div className="min-w-0">
          <div className="rounded-t-md bg-neutral-700 px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-200">
            {block.language}
          </div>
          <pre className="overflow-x-auto rounded-b-md bg-neutral-900 p-2 text-xs text-neutral-100">
            <code>{block.code}</code>
          </pre>
          {block.explanation && <p className="mt-1 text-xs text-neutral-600">{block.explanation}</p>}
        </div>
      );

    case "steps":
      return (
        <div>
          {block.title && <p className="mb-1 text-xs font-semibold text-neutral-600">{block.title}</p>}
          <ol className="list-decimal space-y-0.5 pl-5">
            {block.items.map((s, i) => (
              <li key={i} className="break-words">{s}</li>
            ))}
          </ol>
        </div>
      );

    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {block.headers.map((h, i) => (
                  <th key={i} className="border border-neutral-300 bg-neutral-100 px-2 py-1 text-left font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className="border border-neutral-300 px-2 py-1 align-top break-words">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "diagram":
      return <Diagram title={block.title} primitives={block.primitives} />;

    case "annotation":
      return (
        <p className="rounded-md bg-yellow-50 px-2 py-1 text-xs text-yellow-900">
          <span className="font-medium">Note: </span>
          {block.text}
          {block.targetBlockId && (
            <span className="text-yellow-600"> (re: {block.targetBlockId})</span>
          )}
        </p>
      );
    case "check":
      return (
        <ol className="space-y-1 text-sm" aria-label="Line-by-line check">
          {block.lines.map((l) => (
            <li key={l.lineIndex} className="flex flex-wrap items-baseline gap-1.5">
              <span className={`font-semibold ${l.status === "correct" ? "text-green-700" : l.status === "error" ? "text-red-700" : "text-amber-700"}`}>
                {l.status === "correct" ? "✓ Correct" : l.status === "error" ? "✗ Error" : "? Unclear"}
              </span>
              <span className="text-neutral-500">line {l.lineIndex + 1}</span>
              {l.text && <code className="font-mono text-xs">{l.text}</code>}
              <VerifyBadge status={l.verification} />
              {l.note && <span className="w-full text-neutral-700">{l.note}</span>}
              {l.correction && <span className="w-full font-mono text-xs text-neutral-700">→ {l.correction}</span>}
            </li>
          ))}
        </ol>
      );
    case "graph":
      return (
        <p className="text-sm text-neutral-700">
          Graph{block.title ? `: ${block.title}` : ""} of{" "}
          {block.expressions.map((e) => e.label ? `${e.label} = ${e.expr}` : e.expr).join(", ")} for x in [{block.xRange[0]}, {block.xRange[1]}]
          <span className="text-neutral-500"> — write it to the notebook to plot.</span>
        </p>
      );
  }
}

/** Only "verified" comes from a deterministic check; everything else says so. */
export function VerifyBadge({ status }: { status?: "verified" | "mismatch" | "unknown" }) {
  if (!status) return null;
  const cls = status === "verified" ? "border-green-300 bg-green-50 text-green-800" : "border-neutral-300 bg-neutral-50 text-neutral-600";
  const text = status === "verified" ? "Verified" : status === "mismatch" ? "Not verified: check failed" : "Not verified";
  return <span className={`rounded border px-1 text-[10px] font-medium ${cls}`}>{text}</span>;
}

function List({ items, numbered }: { items: ListItem[]; numbered: boolean }) {
  const Tag = numbered ? "ol" : "ul";
  return (
    <Tag className={`${numbered ? "list-decimal" : "list-disc"} space-y-0.5 pl-5`}>
      {items.map((item, i) => (
        <li key={i} className="break-words">
          {item.text}
          {item.children && item.children.length > 0 && (
            <List items={item.children} numbered={numbered} />
          )}
        </li>
      ))}
    </Tag>
  );
}

/** Renders diagram primitives on a normalized 0-100 SVG canvas. */
function Diagram({ title, primitives }: { title?: string; primitives: DiagramPrimitive[] }) {
  const label = (x: number, y: number, text: string, i: number) => (
    <text key={`t${i}`} x={x} y={y} fontSize={4.5} fill="#334155" textAnchor="middle">
      {text}
    </text>
  );
  return (
    <figure className="rounded-md border border-neutral-200 bg-white p-1">
      {title && <figcaption className="px-1 pb-1 text-xs font-medium text-neutral-600">{title}</figcaption>}
      <svg viewBox="0 0 100 62" className="block h-36 w-full" role="img" aria-label={title ?? "Diagram"}>
        {primitives.map((p, i) => {
          switch (p.type) {
            case "line":
            case "arrow":
              return (
                <line
                  key={i}
                  x1={p.from.x} y1={p.from.y} x2={p.to.x} y2={p.to.y}
                  stroke="#334155" strokeWidth={0.8}
                  markerEnd={p.type === "arrow" ? "url(#arr)" : undefined}
                />
              );
            case "box":
            case "ellipse":
              return p.type === "box" ? (
                <g key={i}>
                  <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={1.5} fill="#eff6ff" stroke="#3b82f6" strokeWidth={0.6} />
                  {p.label && label(p.x + p.w / 2, p.y + p.h / 2 + 1.5, p.label, i)}
                </g>
              ) : (
                <g key={i}>
                  <ellipse cx={p.x + p.w / 2} cy={p.y + p.h / 2} rx={p.w / 2} ry={p.h / 2} fill="#eff6ff" stroke="#3b82f6" strokeWidth={0.6} />
                  {p.label && label(p.x + p.w / 2, p.y + p.h / 2 + 1.5, p.label, i)}
                </g>
              );
            case "label":
              return label(p.x, p.y, p.text, i);
          }
        })}
        <defs>
          <marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#334155" />
          </marker>
        </defs>
      </svg>
    </figure>
  );
}
