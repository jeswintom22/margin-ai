import type { Stroke } from "@/lib/document/types";

/**
 * Handwriting-recognition boundary. No recognition provider is configured in
 * this milestone, so the only implementation is the explicit unsupported
 * adapter — strokes are never silently converted into guessed text and are
 * never mutated.
 */

export type RecognitionMode = "text" | "math";

export type RecognitionResult = {
  supported: boolean;
  /** Recognized text (absent when unsupported or failed). */
  text?: string;
  mode?: RecognitionMode;
  /** 0..1 confidence, when the provider reports one. */
  confidence?: number;
  /** Source ids the recognition ran over — always preserved for provenance. */
  strokeIds: string[];
  pageId?: string;
  reason?: string;
};

export interface InkRecognizer {
  readonly name: string;
  recognize(strokes: Stroke[], mode: RecognitionMode): Promise<RecognitionResult>;
}

/** Default adapter: reports that recognition is not configured. */
export class UnsupportedInkRecognizer implements InkRecognizer {
  readonly name = "unsupported";
  async recognize(strokes: Stroke[], mode: RecognitionMode): Promise<RecognitionResult> {
    return {
      supported: false,
      strokeIds: strokes.map((s) => s.id),
      mode,
      reason: "No handwriting-recognition provider is configured",
    };
  }
}

export const inkRecognizer: InkRecognizer = new UnsupportedInkRecognizer();
