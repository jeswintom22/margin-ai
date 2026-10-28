/**
 * Decoded image cache for blob-backed content (image backgrounds, inserted
 * images) and TeX SVGs. Loads are async; `onLoaded` listeners fire so pages
 * can repaint. The loader is injectable so rendering works in tests/workers.
 */
export type ImageSource = CanvasImageSource & { width: number; height: number };
export type BlobLoader = (blobId: string) => Promise<Blob | undefined>;

const MAX_ENTRIES = 80;

export class AssetCache {
  private images = new Map<string, ImageSource | "loading" | "failed">();
  private listeners = new Set<(key: string) => void>();

  constructor(private loader: BlobLoader) {}

  onLoaded(fn: (key: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(key: string) {
    for (const f of this.listeners) f(key);
  }

  private remember(key: string, v: ImageSource | "loading" | "failed") {
    this.images.delete(key);
    this.images.set(key, v);
    if (this.images.size > MAX_ENTRIES) {
      const oldest = this.images.keys().next().value as string;
      const img = this.images.get(oldest);
      if (img && typeof img === "object" && "close" in img) (img as ImageBitmap).close();
      this.images.delete(oldest);
    }
  }

  /** Decoded image for a blob, or null while loading/failed (load is started). */
  blobImage(blobId: string): ImageSource | null {
    const key = `blob:${blobId}`;
    const hit = this.images.get(key);
    if (hit && typeof hit === "object") {
      this.remember(key, hit);
      return hit;
    }
    if (!hit) {
      this.remember(key, "loading");
      void this.loader(blobId)
        .then((b) => (b ? decode(b) : null))
        .then((img) => {
          this.remember(key, img ?? "failed");
          if (img) this.emit(key);
        })
        .catch(() => this.remember(key, "failed"));
    }
    return null;
  }

  /** Decoded image for an SVG string (TeX), or null while loading. */
  svgImage(svg: string): ImageSource | null {
    const key = `svg:${svg.length}:${hash(svg)}`;
    const hit = this.images.get(key);
    if (hit && typeof hit === "object") return hit;
    if (!hit) {
      this.remember(key, "loading");
      void decode(new Blob([svg], { type: "image/svg+xml" }))
        .then((img) => {
          this.remember(key, img ?? "failed");
          if (img) this.emit(key);
        })
        .catch(() => this.remember(key, "failed"));
    }
    return null;
  }
}

async function decode(blob: Blob): Promise<ImageSource | null> {
  if (typeof createImageBitmap === "function" && blob.type !== "image/svg+xml") return createImageBitmap(blob);
  if (typeof Image === "undefined") return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
