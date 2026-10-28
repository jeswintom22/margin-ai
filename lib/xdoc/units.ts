/**
 * Document units are PDF points (1/72 in), like Xournal++. Screen CSS pixels
 * at 100% zoom are 96 dpi, so 1 pt = 96/72 px. Every stored coordinate is in
 * points; conversion happens only here and in the viewport transform.
 */
export const PX_PER_PT = 96 / 72;
export const PT_PER_PX = 72 / 96;

export const ptToPx = (pt: number) => pt * PX_PER_PT;
export const pxToPt = (px: number) => px * PT_PER_PX;

/** Standard page sizes in points (portrait). */
export const PAGE_SIZES = {
  A4: { width: 595.28, height: 841.89 },
  A5: { width: 419.53, height: 595.28 },
  Letter: { width: 612, height: 792 },
  Legal: { width: 612, height: 1008 },
} as const;

export type PageSizeName = keyof typeof PAGE_SIZES;

/** Clamp for user-entered custom page sizes (points). */
export const PAGE_SIZE_LIMITS = { min: 72, max: 72 * 60 } as const;
