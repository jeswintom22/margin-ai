import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";

/**
 * Full voice-command walkthrough with LLM_MOCK=true against the real
 * /api/ask route. Utterances are simulated via `window.__margin.run(text)` —
 * the same function the recognizer calls — since Playwright has no mic.
 * The mock cannot read images: it answers as if it had transcribed the
 * fixed lines "g(x) = 6x^2" / "g'(x) = 12x"; checks run the real
 * deterministic verifier.
 */

const canvas = (page: Page) => page.getByLabel("Notebook page canvas");
const pages = (page: Page) => page.getByRole("list", { name: "Pages" }).getByRole("listitem");
const num = async (page: Page, a: string) => Number(await canvas(page).getAttribute(a));
const undo = (page: Page) => page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();

/** Simulate an utterance (optionally with pre-transcribed lines). */
const say = (page: Page, text: string, lines?: string[]) =>
  page.evaluate(
    ([t, l]) => (window as unknown as { __margin: { run: (s: string, e?: { lines?: string[] }) => Promise<void> } }).__margin.run(t, l ? { lines: l } : undefined),
    [text, lines] as const
  );

async function strokeAt(page: Page, y: number, x0 = 0.3, x1 = 0.55) {
  const b = (await canvas(page).boundingBox())!;
  await page.mouse.move(b.x + b.width * x0, b.y + b.height * y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + b.width * (x0 + ((x1 - x0) * i) / 12), b.y + b.height * (y + (i % 2 ? 0.004 : 0)));
  await page.mouse.up();
}

/** Lasso a rectangle-ish loop (fractions of the canvas box). */
async function lasso(page: Page, x0: number, y0: number, x1: number, y1: number) {
  await page.getByRole("button", { name: "Lasso select (L)" }).click();
  const b = (await canvas(page).boundingBox())!;
  const P = (fx: number, fy: number) => [b.x + b.width * fx, b.y + b.height * fy] as const;
  const loop = [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1), P(x0, y0 + 0.005)];
  await page.mouse.move(...loop[0]);
  await page.mouse.down();
  for (const pt of loop.slice(1)) await page.mouse.move(...pt, { steps: 8 });
  await page.mouse.up();
}

test("voice walkthrough: check, wrong line, finish, hint, graph, PDF, reload, export/import, mobile", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" || (m.type() === "warning" && /hydrat/i.test(m.text()))) problems.push(`${m.type()}: ${m.text()}`);
  });

  await page.goto("/");
  await expect(canvas(page)).toBeVisible();

  // a. two handwritten lines
  await page.getByRole("button", { name: "Pen (P)" }).click();
  await strokeAt(page, 0.2);
  await strokeAt(page, 0.28);
  await expect(canvas(page)).toHaveAttribute("data-user-strokes", "2");

  // b. lasso both lines → "check my work" → image+mode sent, marks written, undo
  await lasso(page, 0.25, 0.15, 0.62, 0.33);
  await expect(page.getByText(/2 strokes selected/)).toBeVisible();
  const checkReq = page.waitForRequest((r) => r.url().endsWith("/api/ask") && r.postDataJSON()?.mode === "check");
  await say(page, "check my work");
  const checkBody = (await checkReq).postDataJSON();
  expect(checkBody.image).toMatch(/^data:image\/png;base64,/);
  await expect.poll(() => num(page, "data-ai-elements")).toBeGreaterThanOrEqual(2); // a mark per line
  await undo(page);
  await expect(canvas(page)).toHaveAttribute("data-ai-elements", "0");
  await expect(canvas(page)).toHaveAttribute("data-user-strokes", "2");

  // c. wrong line is flagged deterministically (lines supplied: verifier runs)
  await lasso(page, 0.25, 0.15, 0.62, 0.33);
  const cResp = page.waitForResponse((r) => r.url().endsWith("/api/ask"));
  await say(page, "check my work", ["g(x) = 6x^2", "g'(x) = 6x"]);
  await cResp;
  await expect.poll(() => num(page, "data-ai-elements")).toBeGreaterThanOrEqual(3); // tick + cross + underline (+ note)
  await undo(page);
  await expect(canvas(page)).toHaveAttribute("data-ai-elements", "0");

  // d. finish + hint go beside the work on the page
  await lasso(page, 0.25, 0.15, 0.62, 0.33);
  const fResp = page.waitForResponse((r) => r.url().endsWith("/api/ask"));
  await say(page, "finish this");
  await fResp;
  await expect.poll(() => num(page, "data-ai-elements")).toBeGreaterThan(0);
  const afterFinish = await num(page, "data-ai-elements");
  const hResp = page.waitForResponse((r) => r.url().endsWith("/api/ask"));
  await say(page, "hint please");
  await hResp;
  await expect.poll(() => num(page, "data-ai-elements")).toBeGreaterThan(afterFinish);
  await undo(page);
  await undo(page);
  await expect(canvas(page)).toHaveAttribute("data-ai-elements", "0");

  // e. graph appears (axes + curve) and undo removes it
  await lasso(page, 0.25, 0.15, 0.62, 0.33);
  const gResp = page.waitForResponse((r) => r.url().endsWith("/api/ask"));
  await say(page, "graph this");
  await gResp;
  await expect.poll(() => num(page, "data-ai-elements")).toBeGreaterThan(20);
  await undo(page);
  await expect(canvas(page)).toHaveAttribute("data-ai-elements", "0");

  // f. import a 2-page PDF; ink on top; lasso captures background + ink
  const before = await pages(page).count();
  await page.getByLabel("Import PDF").setInputFiles(path.join(__dirname, "fixtures", "homework.pdf"));
  await expect(pages(page)).toHaveCount(before + 2, { timeout: 30_000 });
  await expect(canvas(page)).toHaveAttribute("data-has-background", "true");
  await page.getByRole("button", { name: "Pen (P)" }).click();
  await strokeAt(page, 0.22, 0.6, 0.7);
  await expect(canvas(page)).toHaveAttribute("data-user-strokes", "1");
  const imageReq = page.waitForRequest((r) => r.url().endsWith("/api/ask") && (r.postDataJSON()?.mode === "transcribe"));
  const trResp = page.waitForResponse((r) => r.url().endsWith("/api/ask"));
  await lasso(page, 0.02, 0.05, 0.98, 0.26);
  await say(page, "read my handwriting");
  const sent: string = (await imageReq).postDataJSON().image;
  const dark = await page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128 && d[i + 1] < 128 && d[i + 2] < 128) n++;
    return n;
  }, sent);
  expect(dark).toBeGreaterThan(1500); // PDF text glyphs, not just one short stroke
  await trResp;

  // g. graph beside the transcribed work; reload keeps ink, marks, background
  await lasso(page, 0.02, 0.05, 0.98, 0.26);
  const g2Resp = page.waitForResponse((r) => r.url().endsWith("/api/ask"));
  await say(page, "graph this");
  await g2Resp;
  await expect.poll(() => num(page, "data-ai-elements")).toBeGreaterThan(20);
  const aiOnPdf = await num(page, "data-ai-elements");
  await expect(page.locator("header").getByRole("status")).toHaveText("Saved");
  const total = await pages(page).count();
  await page.reload();
  await expect(pages(page)).toHaveCount(total);
  await expect(canvas(page)).toHaveAttribute("data-user-strokes", "2"); // page 1 ink survived
  await pages(page).nth(1).getByRole("button").first().click(); // first PDF page (inserted after page 1)
  await expect(canvas(page)).toHaveAttribute("data-has-background", "true");
  await expect(canvas(page)).toHaveAttribute("data-user-strokes", "1");
  expect(await num(page, "data-ai-elements")).toBe(aiOnPdf);

  // h. export JSON and re-import it: identical structure
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menu", { name: "File" }).getByText(/Export notebook/).click();
  const file = await (await download).path();
  const exported = JSON.parse(readFileSync(file!, "utf8"));
  expect(exported.notebook.schemaVersion).toBe(3);
  expect(exported.notebook.pages).toHaveLength(total);
  await page.locator('input[accept=".json,application/json"]').setInputFiles(file!);
  await expect(pages(page)).toHaveCount(total);
  await pages(page).nth(1).getByRole("button").first().click();
  await expect(canvas(page)).toHaveAttribute("data-has-background", "true");

  // i. narrow viewport: no horizontal overflow, canvas usable, mobile menu sheet works
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas(page)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Menu" }).click();
  const sheet = page.getByRole("dialog", { name: "Menu" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "View" }).click();
  await expect(sheet.getByText("Fit page width")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  expect(problems).toEqual([]);
});

test("an old v1 export migrates on import", async ({ page }) => {
  await page.goto("/");
  await expect(canvas(page)).toBeVisible();
  const v1 = {
    format: "margin-ai-notebook", formatVersion: 1,
    notebook: {
      id: "old", title: "Old v1 notebook", schemaVersion: 1, createdAt: 1, updatedAt: 2,
      pages: [{ id: "p1", title: "Legacy", width: 794, height: 1123, paperStyle: "ruled", eraserOperations: [],
        layers: [{ id: "l1", name: "Ink", author: "user", visible: true,
          strokes: [{ id: "s1", points: [{ x: 100, y: 100 }, { x: 300, y: 120 }], color: "#000", width: 2, tool: "pen", author: "user" }] }] }],
    },
  };
  await page.locator('input[accept=".json,application/json"]').setInputFiles({ name: "old.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(v1)) });
  await expect(page.getByLabel("Notebook title")).toHaveValue("Old v1 notebook");
  await expect(canvas(page)).toHaveAttribute("data-user-strokes", "1");
});
