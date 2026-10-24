export type SaveState = "idle" | "saving" | "saved" | "error";

export interface AutoSaverOptions {
  /** Debounce delay for coalescing edits before saving. */
  delayMs: number;
  /** Persist the current document. Must reject on failure. */
  save: () => Promise<void>;
  /** Called whenever the observable save status changes. */
  onStatus?: (status: SaveState) => void;
}

/**
 * Coordinates debounced persistence for a single mutable document.
 *
 * Guarantees:
 * - Status is "saved" only after `save()` resolves with no newer edits pending.
 * - Edits made while a save is in flight keep the document dirty and trigger
 *   a follow-up save, so a stale in-flight write cannot falsely mark the doc
 *   as saved.
 * - Saves are serialized: `flush()` during an in-flight save does not start a
 *   second concurrent write; the in-flight loop picks up the dirty flag.
 * - Failed saves set status "error", stay dirty, and are retried after the
 *   debounce delay until they succeed or `cancelPending()` is called.
 */
export class AutoSaver {
  private dirty = false;
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private status: SaveState = "idle";

  constructor(private readonly opts: AutoSaverOptions) {}

  /** True while edits exist that have not been confirmed persisted. */
  get pending(): boolean {
    return this.dirty || this.timer !== null;
  }

  /** Record an edit and schedule a debounced save. */
  markDirty(): void {
    this.dirty = true;
    this.setStatus("saving");
    this.schedule();
  }

  /**
   * Save now if dirty. Safe to call from lifecycle events (pagehide,
   * visibilitychange); completion is not guaranteed if the page is closed.
   * No-op if a save is already in flight — that save's loop observes the
   * current dirty flag after its write resolves.
   */
  async flush(): Promise<void> {
    this.clearTimer();
    if (this.inFlight || !this.dirty) return;
    this.inFlight = true;
    try {
      while (this.dirty) {
        this.dirty = false;
        this.setStatus("saving");
        try {
          await this.opts.save();
        } catch {
          // Stay dirty and retry later; never report a false "saved".
          this.dirty = true;
          this.setStatus("error");
          this.schedule();
          return;
        }
      }
      this.setStatus("saved");
    } finally {
      this.inFlight = false;
      // An edit may have raced the loop exit; re-arm if so.
      if (this.dirty && this.timer === null) this.schedule();
    }
  }

  /** Drop pending unsaved state (e.g. document reloaded or switched). */
  cancelPending(): void {
    this.clearTimer();
    this.dirty = false;
  }

  private schedule(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.opts.delayMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private setStatus(status: SaveState): void {
    if (status === this.status) return;
    this.status = status;
    this.opts.onStatus?.(status);
  }
}
