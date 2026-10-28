import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "fs";

/**
 * Margin v2 editor (/v2), phase 1: engine + shell. Real browser input:
 * mouse via page.mouse; pen and touch via dispatched PointerEvents (with
 * pressure / eraser button), since Playwright has no stylus.
 */

const ws = (p: Page) => p.getByTestId("workspace");
const pageCanvas = (p: Page, i = 0) => p.locator(`canvas[data-page-index='${i}']`);
const thumbs = (p: Page) => p.getByRole("list", { name: "Pages" }).getByRole("listitem");

async function open(p: Page) {
  await p.goto("/v2");
  await expect(pageCanvas(p)).toBeVisible();
}

async function mouseLine(p: Page, y: number, x0 = 0.2, x1 = 0.6, i = 0) {
  const b = (await pageCanvas(p, i).boundingBox())!;
  await p.mouse.move(b.x + b.width * x0, b.y + y);
  await p.mouse.down();
  for (let k = 1; k <= 12; k++) await p.mouse.move(b.x + b.width * (x0 + ((x1 - x0) * k) / 12), b.y + y);
  await p.mouse.up();
}

/** Dispatch a synthetic pointer gesture on the workspace. */
async function pointerPath(p: Page, type: "pen" | "touch", pts: { x: number; y: number; pressure?: number }[], opts: { button?: number; buttons?: number; id?: number } = {}) {
  await ws(p).evaluate(
    (el, { type, pts, button, buttons, id }) => {
      const mk = (t: string, q: { x: number; y: number; pressure?: number }) =>
        new PointerEvent(t, { pointerId: id, pointerType: type, clientX: q.x, clientY: q.y, pressure: q.pressure ?? 0.5, button: t === "pointermove" ? -1 : button, buttons: t === "pointerup" ? 0 : buttons, bubbles: true, cancelable: true });
      el.dispatchEvent(mk("pointerdown", pts[0]));
      for (const q of pts.slice(1)) el.dispatchEvent(mk("pointermove", q));
      el.dispatchEvent(mk("pointerup", pts[pts.length - 1]));
    },
    { type, pts, button: opts.button ?? 0, buttons: opts.buttons ?? 1, id: opts.id ?? 11 }
  );
}

async function exportJson(p: Page) {
  const dl = p.waitForEvent("download");
  await p.getByRole("button", { name: "File", exact: true }).click();
  await p.getByRole("menu", { name: "File" }).getByText(/Export notebook/).click();
  return JSON.parse(readFileSync((await (await dl).path())!, "utf8"));
}

test("draw, undo/redo, three eraser modes", async ({ page }) => {
  await open(page);
  await mouseLine(page, 200);
  await expect(pageCanvas(page)).toHaveAttribute("data-user-elements", "1");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(pageCanvas(page)).toHaveAttribute("data-user-elements", "0");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(pageCanvas(page)).toHaveAttribute("data-user-elements", "1");

  const b = (await pageCanvas(page).boundingBox())!;
  const cx = b.x + b.width * 0.4;
  await page.getByRole("button", { name: "Eraser" }).click();
  await page.mouse.move(cx, b.y + 170);
  await page.mouse.down();
  await page.mouse.move(cx, b.y + 230, { steps: 6 });
  await page.mouse.up();
  await expect(pageCanvas(page)).toHaveAttribute("data-user-elements", "2"); // split in two
  await page.keyboard.press("Control+z");
  await expect(pageCanvas(page)).toHaveAttribute("data-user-elements", "1");

  await page.getByRole("radio", { name: "Whiteout" }).click();
  await page.mouse.move(cx, b.y + 170);
  await page.mouse.down();
  await page.mouse.move(cx, b.y + 230, { steps: 6 });
  await page.mouse.up();
  await expect(pageCanvas(page)).toHaveAttribute("data-user-elements", "2"); // ink + whiteout stroke

  await page.getByRole("radio", { name: "Delete stroke" }).click();
  await page.mouse.move(b.x + b.width * 0.25, b.y + 190);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.25, b.y + 210, { steps: 4 });
  await page.mouse.up();
  await expect(pageCanvas(page)).toHaveAttribute("data-user-elements", "1"); // ink line deleted whole
});

test("stylus: pressure widths, eraser end erases, palm/touch pans instead of drawing", async ({ page }) => {
  await open(page);
  const b = (await pageCanvas(page).boundingBox())!;
  const y = b.y + 150;
  await pointerPath(page, "pen", Array.from({ length: 25 }, (_, i) => ({ x: b.x + 80 + i * 14, y, pressure: 0.1 + i * 0.035 })));
  await expect(pageCanvas(page)).toHaveAttribute("data-user-elements", "1");

  const doc = await exportJson(page);
  const stroke = doc.notebook.pages[0].layers[0].elements[0];
  expect(stroke.widths.length).toBe(stroke.points.length);
  expect(Math.max(...stroke.widths)).toBeGreaterThan(Math.min(...stroke.widths) * 1.5);

  // eraser end (button 5 / buttons 32) erases even though the Pen tool is active
  await pointerPath(page, "pen", [{ x: b.x + 200, y: y - 20 }, { x: b.x + 200, y: y + 20 }], { button: 5, buttons: 32, id: 12 });
  await expect(pageCanvas(page)).toHaveAttribute("data-user-elements", "2");
  await expect(page.getByRole("button", { name: "Pen" })).toHaveAttribute("aria-pressed", "true");

  // after a pen was used, a finger scrolls instead of drawing
  await page.getByRole("button", { name: "Insert page after" }).click();
  const before = await ws(page).evaluate((el) => el.scrollTop);
  await pointerPath(page, "touch", [{ x: b.x + 300, y: b.y + 500 }, { x: b.x + 300, y: b.y + 400 }, { x: b.x + 300, y: b.y + 300 }], { id: 20 });
  await expect.poll(() => ws(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
  await expect(pageCanvas(page)).toHaveAttribute("data-user-elements", "2");
});

test("pages: insert, duplicate, move, delete with undo; template; reload persists", async ({ page }) => {
  await open(page);
  await mouseLine(page, 200);
  await page.getByRole("button", { name: "Insert page after" }).click();
  await expect(thumbs(page)).toHaveCount(2);
  await page.getByRole("button", { name: "Duplicate page 1" }).click();
  await expect(thumbs(page)).toHaveCount(3);
  await expect(page.getByTestId("page-indicator")).toHaveText("of 3");
  await page.getByRole("button", { name: "Delete page 2" }).click();
  await expect(thumbs(page)).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(thumbs(page)).toHaveCount(3);

  // template: graph paper on all pages, one undo step
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await page.getByRole("menu", { name: "Journal" }).getByText("Page template…").click();
  await page.getByRole("radio", { name: "Graph", exact: true }).click();
  await page.getByRole("button", { name: "Apply to all pages" }).click();
  await expect(pageCanvas(page)).toHaveAttribute("data-background", "graph");

  await expect(page.getByRole("status").first()).toHaveText("Saved");
  await page.reload();
  await expect(thumbs(page)).toHaveCount(3);
  await expect(pageCanvas(page)).toHaveAttribute("data-background", "graph");
  await expect(pageCanvas(page)).toHaveAttribute("data-user-elements", "1");
  // history does not survive reload by design
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("legacy Margin AI v1 export imports into the new model", async ({ page }) => {
  await open(page);
  const v1 = {
    format: "margin-ai-notebook", formatVersion: 1,
    notebook: { id: "old", title: "Old v1 notebook", schemaVersion: 1, createdAt: 1, updatedAt: 2,
      pages: [{ id: "p1", title: "Legacy", width: 794, height: 1123, paperStyle: "grid", eraserOperations: [],
        layers: [{ id: "l1", name: "Ink", author: "user", visible: true,
          strokes: [{ id: "s1", points: [{ x: 100, y: 100 }, { x: 300, y: 120 }], color: "#000", width: 2, tool: "pen", author: "user" }] }] }] },
  };
  await page.getByLabel("Import notebook file").setInputFiles({ name: "old.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(v1)) });
  await expect(page.getByLabel("Notebook title")).toHaveValue("Old v1 notebook");
  await expect(pageCanvas(page)).toHaveAttribute("data-user-elements", "1");
  await expect(pageCanvas(page)).toHaveAttribute("data-background", "graph");
  await expect(page.getByText(/classic Margin AI format/)).toBeVisible();
});

test("phone viewport: menu sheet opens, no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Menu" }).click();
  const sheet = page.getByRole("dialog", { name: "Menu" });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
});

test("benchmark: 200 pages × 300 strokes open and scroll smoothly", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  // Build a large notebook file in the browser and import it through the UI.
  const file = await page.evaluate(() => {
    const id = (n: string) => `${n}-${Math.random().toString(36).slice(2, 9)}`;
    const pages = Array.from({ length: 200 }, () => ({
      id: id("p"), width: 595.28, height: 841.89, background: { kind: "solid", style: "lined", color: "#ffffff" },
      layers: [{ id: id("l"), name: "Layer 1", visible: true, author: "user",
        elements: Array.from({ length: 300 }, (_, k) => ({
          id: id("s"), type: "stroke", tool: "pen", color: "#000000", width: 1.41,
          points: Array.from({ length: 12 }, (_, j) => ({ x: 40 + (k % 10) * 52 + j * 4, y: 60 + Math.floor(k / 10) * 25 + Math.sin(j) * 4 })),
        })) }],
    }));
    return JSON.stringify({ format: "margin-notebook", formatVersion: 2, blobs: [], notebook: { id: id("n"), title: "Bench", schemaVersion: 4, createdAt: 1, updatedAt: 1, pages } });
  });
  const t0 = Date.now();
  await page.getByLabel("Import notebook file").setInputFiles({ name: "bench.margin.json", mimeType: "application/json", buffer: Buffer.from(file) });
  await expect(page.getByTestId("page-indicator")).toHaveText("of 200", { timeout: 60_000 });
  await expect(pageCanvas(page)).toHaveAttribute("data-user-elements", "300");
  const openMs = Date.now() - t0;

  // Scroll through 40 pages and record frame times.
  const frames = await ws(page).evaluate(async (el) => {
    const times: number[] = [];
    let last = performance.now();
    for (let i = 0; i < 120; i++) {
      el.scrollTop += 300;
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      times.push(now - last);
      last = now;
    }
    times.sort((a, b) => a - b);
    return { p50: times[60], p90: times[108], max: times[119] };
  });
  // only a handful of page canvases are mounted (virtualized)
  expect(await page.locator("canvas[data-page-index]").count()).toBeLessThanOrEqual(6);

  // Reopen from IndexedDB: time from navigation to first page painted.
  await expect(page.getByRole("status").first()).toHaveText("Saved", { timeout: 60_000 });
  const t1 = Date.now();
  await page.reload();
  await expect(pageCanvas(page)).toHaveAttribute("data-user-elements", "300", { timeout: 60_000 });
  const reopenMs = Date.now() - t1;

  // Inking on a 300-stroke page: sample frame times while a stroke is drawn.
  const b = (await pageCanvas(page).boundingBox())!;
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __run: boolean };
    w.__frames = [];
    w.__run = true;
    let last = performance.now();
    const tick = (now: number) => {
      w.__frames.push(now - last);
      last = now;
      if (w.__run) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(b.x + 60, b.y + 700);
  await page.mouse.down();
  for (let i = 0; i < 90; i++) await page.mouse.move(b.x + 60 + i * 6, b.y + 700 + Math.sin(i / 5) * 40);
  await page.mouse.up();
  const ink = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __run: boolean };
    w.__run = false;
    const t = w.__frames.slice(2).sort((a, b) => a - b);
    return { p50: t[Math.floor(t.length / 2)], p90: t[Math.floor(t.length * 0.9)] };
  });
  await expect(pageCanvas(page)).toHaveAttribute("data-user-elements", "301");

  console.log(`bench: import ${openMs} ms, reopen ${reopenMs} ms, scroll frames ${JSON.stringify(frames)}, inking frames ${JSON.stringify(ink)}`);
  expect(openMs).toBeLessThan(15_000); // JSON parse + validation + IndexedDB save of ~720k points
  expect(reopenMs).toBeLessThan(4_000);
  expect(frames.p50).toBeLessThan(34);
  expect(ink.p50).toBeLessThan(20);
});
