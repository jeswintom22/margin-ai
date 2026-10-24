// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AutoSaver, type SaveState } from "@/lib/storage/autosave";

const DELAY = 100;

function deferred<T = void>() {
  let resolve!: (v: T | PromiseLike<T>) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeSaver(save: () => Promise<void>) {
  const statuses: SaveState[] = [];
  const saver = new AutoSaver({
    delayMs: DELAY,
    save,
    onStatus: (s) => statuses.push(s),
  });
  return { saver, statuses };
}

/** Flush microtask queue so in-flight saves can progress. */
async function tick(times = 20) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("AutoSaver", () => {
  it("reports saved only after the write completes", async () => {
    const d = deferred();
    const { saver, statuses } = makeSaver(() => d.promise);

    saver.markDirty();
    expect(saver.pending).toBe(true);

    await vi.advanceTimersByTimeAsync(DELAY);
    // Write started but not finished: must not claim saved.
    expect(statuses).not.toContain("saved");
    expect(statuses.at(-1)).toBe("saving");

    d.resolve();
    await tick();
    expect(statuses.at(-1)).toBe("saved");
    expect(saver.pending).toBe(false);
  });

  it("keeps error status and stays dirty when the write fails, then retries", async () => {
    const d = deferred();
    let calls = 0;
    const { saver, statuses } = makeSaver(() => {
      calls++;
      return calls === 1 ? d.promise : Promise.resolve();
    });

    saver.markDirty();
    await vi.advanceTimersByTimeAsync(DELAY);
    d.reject(new Error("quota exceeded"));
    await tick();

    expect(statuses.at(-1)).toBe("error");
    expect(statuses).not.toContain("saved");
    expect(saver.pending).toBe(true);

    // Retry fires after another debounce interval and succeeds.
    await vi.advanceTimersByTimeAsync(DELAY);
    await tick();
    expect(calls).toBe(2);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("keeps dirty and re-saves when an edit lands during an in-flight save", async () => {
    const first = deferred();
    const saved: number[] = [];
    let doc = 1;
    let calls = 0;
    const { saver, statuses } = makeSaver(() => {
      calls++;
      saved.push(doc); // capture at call time, like IndexedDB structured clone
      return calls === 1 ? first.promise : Promise.resolve();
    });

    saver.markDirty();
    await vi.advanceTimersByTimeAsync(DELAY);

    // Edit while the first write is still in flight.
    doc = 2;
    saver.markDirty();
    first.resolve();
    // Let the redundant debounce timer armed by the mid-flight edit fire too.
    await vi.advanceTimersByTimeAsync(DELAY);
    await tick();

    expect(calls).toBe(2);
    expect(saved).toEqual([1, 2]);
    expect(statuses.at(-1)).toBe("saved");
    expect(saver.pending).toBe(false);
  });

  it("serializes concurrent flush calls — no overlapping writes", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { saver } = makeSaver(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
    });

    saver.markDirty();
    const p1 = saver.flush();
    const p2 = saver.flush();
    const p3 = saver.flush();
    await Promise.all([p1, p2, p3]);
    await tick();
    expect(maxInFlight).toBe(1);
  });

  it("coalesces rapid edits into a single debounced save of the latest state", async () => {
    let doc = 0;
    const saved: number[] = [];
    const { saver } = makeSaver(() => {
      saved.push(doc);
      return Promise.resolve();
    });

    for (let i = 0; i < 5; i++) {
      doc = i + 1;
      saver.markDirty();
      await vi.advanceTimersByTimeAsync(DELAY / 2);
    }
    await vi.advanceTimersByTimeAsync(DELAY);
    await tick();

    expect(saved).toEqual([5]);
  });

  it("flush persists a pending debounced save immediately (lifecycle event)", async () => {
    let calls = 0;
    const { saver, statuses } = makeSaver(() => {
      calls++;
      return Promise.resolve();
    });

    saver.markDirty();
    // Page is hidden/closed before the debounce fires.
    await saver.flush();
    await tick();

    expect(calls).toBe(1);
    expect(statuses.at(-1)).toBe("saved");
    // The cancelled debounce must not fire a second save.
    await vi.advanceTimersByTimeAsync(DELAY * 2);
    await tick();
    expect(calls).toBe(1);
  });

  it("flush during an in-flight save does not lose the dirty state", async () => {
    const first = deferred();
    let doc = 1;
    const saved: number[] = [];
    let calls = 0;
    const { saver } = makeSaver(() => {
      calls++;
      saved.push(doc);
      return calls === 1 ? first.promise : Promise.resolve();
    });

    saver.markDirty();
    await vi.advanceTimersByTimeAsync(DELAY);

    // Lifecycle flush while write is in flight, then a newer edit.
    void saver.flush();
    doc = 2;
    saver.markDirty();
    first.resolve();
    await tick();

    // The stale snapshot went through first, but the newer state was re-saved.
    expect(saved).toEqual([1, 2]);
  });

  it("cancelPending drops unsaved edits", async () => {
    let calls = 0;
    const { saver } = makeSaver(() => {
      calls++;
      return Promise.resolve();
    });

    saver.markDirty();
    saver.cancelPending();
    await vi.advanceTimersByTimeAsync(DELAY * 2);
    await tick();

    expect(calls).toBe(0);
    expect(saver.pending).toBe(false);
  });

  it("does not save when nothing is dirty", async () => {
    let calls = 0;
    const { saver } = makeSaver(() => {
      calls++;
      return Promise.resolve();
    });
    await saver.flush();
    await vi.advanceTimersByTimeAsync(DELAY * 2);
    expect(calls).toBe(0);
  });
});
