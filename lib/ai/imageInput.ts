import { LLMError } from "./llm";

/** Server-side validation of client-supplied notebook images (data URLs). */

export const IMAGE_LIMITS = {
  base64Chars: 3_000_000, // ≈2.2MB decoded
  maxDim: 4096,
  minDim: 4,
} as const;

export type NotebookImage = {
  mime: "image/png" | "image/jpeg";
  base64: string;
  width: number;
  height: number;
};

function pngDims(b64: string): { w: number; h: number } | null {
  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}

function jpegDims(b64: string): { w: number; h: number } | null {
  try {
    const buf = Buffer.from(b64, "base64");
    let i = 2;
    while (i + 9 < buf.length) {
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3)
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}

/** Parse and validate a `data:` URL; throws LLMError on any failure. */
export function parseImageInput(input: unknown): NotebookImage {
  if (typeof input !== "string" || !input.startsWith("data:"))
    throw new LLMError("The request image is missing or invalid", 400);
  const m = /^data:(image\/(?:png|jpeg));base64,([\s\S]*)$/.exec(input);
  if (!m) throw new LLMError("Only PNG or JPEG images are supported", 400);
  const base64 = m[2];
  if (base64.length > IMAGE_LIMITS.base64Chars)
    throw new LLMError("The image is too large", 400);
  const dims = m[1] === "image/png" ? pngDims(base64) : jpegDims(base64);
  if (!dims) throw new LLMError("The image data could not be read", 400);
  if (
    dims.w < IMAGE_LIMITS.minDim || dims.h < IMAGE_LIMITS.minDim ||
    dims.w > IMAGE_LIMITS.maxDim || dims.h > IMAGE_LIMITS.maxDim
  )
    throw new LLMError("The image dimensions are outside the supported range", 400);
  return { mime: m[1] as NotebookImage["mime"], base64, width: dims.w, height: dims.h };
}
