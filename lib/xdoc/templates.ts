import type { BackgroundStyle } from "./types";

/** Background styles offered in the page template dialog, with Xournal++-like names. */
export const BACKGROUND_STYLES: { style: BackgroundStyle; label: string }[] = [
  { style: "plain", label: "Plain" },
  { style: "lined", label: "Lined" },
  { style: "ruled", label: "Ruled (with margin)" },
  { style: "graph", label: "Graph" },
  { style: "dotted", label: "Dotted" },
  { style: "isoDotted", label: "Isometric dotted" },
  { style: "isoGraph", label: "Isometric graph" },
  { style: "staves", label: "Music staves" },
];

/** Paper colors (Xournal++ defaults-inspired). */
export const PAPER_COLORS = [
  { color: "#ffffff", label: "White" },
  { color: "#fffbe6", label: "Yellow" },
  { color: "#f2fbff", label: "Blue" },
  { color: "#f3fff2", label: "Green" },
  { color: "#fff2f4", label: "Pink" },
  { color: "#f4f1ea", label: "Cream" },
  { color: "#2b2b2b", label: "Dark" },
] as const;

/** Background geometry in points (shared by renderer and exporters). */
export const RULING = {
  lineSpacing: 24, // lined/ruled
  headerSpace: 72, // ruled: blank band at top
  marginX: 72, // ruled: vertical red margin
  gridSize: 14.17, // 5 mm
  dotSize: 14.17,
  isoSize: 14.17,
  staveGap: 6, // between lines in a stave
  staveSpacing: 60, // between staves
} as const;

/** True for dark paper (so default ink/rule colors can adapt). */
export function isDarkColor(hex: string): boolean {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
}
