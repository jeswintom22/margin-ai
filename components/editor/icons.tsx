/** Minimal stroke icon set (24×24, currentColor). */
export const ICONS = {
  menu: "M4 6h16M4 12h16M4 18h16",
  pen: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z",
  highlighter: "M9 11l6 6M15 4l5 5-8.5 8.5H7.5V13.5L15 4zM5 21h14",
  eraser: "M16 3l5 5-9.5 9.5H7L3 13.5 12 5l4-2zM6 21h12",
  hand: "M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5V4a1.5 1.5 0 0 1 3 0v8M14 11V5.5a1.5 1.5 0 0 1 3 0V13M17 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.3 14a1.5 1.5 0 0 1 2.5-1.7L8 14",
  undo: "M9 14 4 9l5-5M4 9h9a7 7 0 0 1 0 14h-3",
  redo: "m15 14 5-5-5-5M20 9h-9a7 7 0 0 0 0 14h3",
  pageAdd: "M6 3h9l4 4v14H6zM15 3v4h4M12.5 11v6M9.5 14h6",
  prev: "M15 18l-6-6 6-6",
  next: "M9 18l6-6-6-6",
  kebab: "M12 5.5h.01M12 12h.01M12 18.5h.01",
  sidebar: "M3 4h18v16H3zM9 4v16",
} as const;

export function Icon({ d, className = "h-[18px] w-[18px]" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={d} />
    </svg>
  );
}
