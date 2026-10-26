import { test, expect, type Page } from "@playwright/test";

/** Deterministic multi-page answer: too long to fit one page even when shrunk. */
const LONG_ANSWER = {
  schemaVersion: 1,
  title: "Mock answer",
  blocks: Array.from({ length: 70 }, (_, i) => ({
    id: `b${i + 1}`,
    type: "paragraph",
    text: `Paragraph ${i + 1}: ` + "lorem ipsum dolor sit amet ".repeat(6).trim(),
  })),
  metadata: { verificationStatus: "unverified" },
};

const SHORT_ANSWER = {
  schemaVersion: 1,
  title: "Short mock",
  blocks: [{ id: "b1", type: "paragraph", text: "Two plus two is four." }],
  metadata: { verificationStatus: "unverified" },
};

async function mockAsk(page: Page, answer: unknown) {
  await page.route("**/api/ask", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answer }) })
  );
}

const canvas = (page: Page) => page.getByLabel("Notebook page canvas");
const pages = (page: Page) => page.getByRole("list", { name: "Pages" }).getByRole("listitem");
const attr = (page: Page, name: string) => canvas(page).getAttribute(name);

async function open(page: Page) {
  await page.goto("/");
  await expect(canvas(page)).toBeVisible();
}

/** Draw a horizontal stroke across the page at a relative height. */
async function drawLine(page: Page, yFrac = 0.4, xFrom = 0.35, xTo = 0.65) {
  const box = (await canvas(page).boundingBox())!;
  const y = box.y + box.height * yFrac;
  await page.mouse.move(box.x + box.width * xFrom, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width * (xFrom + ((xTo - xFrom) * i) / 10), y);
  await page.mouse.up();
}

/** Drag the eraser vertically through the middle of a drawn line. */
async function eraseThrough(page: Page, yFrac = 0.4) {
  await page.getByRole("button", { name: "Eraser (E)" }).click();
  const box = (await canvas(page).boundingBox())!;
  const x = box.x + box.width * 0.5;
  await page.mouse.move(x, box.y + box.height * (yFrac - 0.05));
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x, box.y + box.height * (yFrac - 0.05 + 0.01 * i));
  await page.mouse.up();
}

/** Drive the voice pipeline's run() path: same code a spoken question hits. */
async function askAndInsert(page: Page, text = "Explain something") {
  await page.evaluate((t) => (window as unknown as { __margin: { run: (s: string) => Promise<void> } }).__margin.run(t), text);
  await expect(page.getByRole("status").getByText(/Written|Marks written/)).toBeVisible();
}

const undo = (page: Page) => page.getByRole("button", { name: "Undo (Ctrl+Z)" }).click();
const redo = (page: Page) => page.getByRole("button", { name: "Redo (Ctrl+Y)" }).click();

/** Open a menubar menu and click an item by its visible text. */
async function menuItem(page: Page, menu: string, name: string | RegExp) {
  await page.getByRole("button", { name: menu, exact: true }).click();
  await page.getByRole("menu", { name: menu }).getByText(name).click();
}

test("A: drawing, undo/redo, erase and undo erase", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Pen (P)" }).click();
  await drawLine(page);
  await expect(canvas(page)).toHaveAttribute("data-user-strokes", "1");

  await undo(page);
  await expect(canvas(page)).toHaveAttribute("data-user-strokes", "0");
  await redo(page);
  await expect(canvas(page)).toHaveAttribute("data-user-strokes", "1");

  // The eraser removes only the ink under it: the line splits into two pieces.
  await eraseThrough(page);
  await expect(canvas(page)).toHaveAttribute("data-user-strokes", "2");
  await undo(page);
  await expect(canvas(page)).toHaveAttribute("data-user-strokes", "1");
});

test("B: multi-page insertion undo from another page, redo without duplication", async ({ page }) => {
  await mockAsk(page, LONG_ANSWER);
  await open(page);
  await page.getByRole("button", { name: "+ Page" }).click();
  await expect(pages(page)).toHaveCount(2);
  await pages(page).nth(0).getByRole("button").first().click();

  await askAndInsert(page);
  const total = await pages(page).count();
  expect(total).toBeGreaterThan(2); // continuation page(s) created after page 1
  expect(Number(await attr(page, "data-ai-elements"))).toBeGreaterThan(0);

  // Go to a continuation page created by the insertion and undo from there.
  await pages(page).nth(1).getByRole("button").first().click();
  await expect(pages(page).nth(1).getByRole("button").first()).toHaveAttribute("aria-current", "page");
  expect(Number(await attr(page, "data-ai-elements"))).toBeGreaterThan(0);
  await undo(page);
  await expect(pages(page)).toHaveCount(2); // created page removed; user's own page 2 kept
  await expect(canvas(page)).toHaveAttribute("data-ai-elements", "0"); // focused back to page 1

  await redo(page);
  await expect(pages(page)).toHaveCount(total);
  const afterRedo = Number(await attr(page, "data-ai-elements"));
  expect(afterRedo).toBeGreaterThan(0);

  // Subsequent user ink on a created page is undone first; the insertion stays.
  await pages(page).nth(1).getByRole("button").first().click();
  await page.getByRole("button", { name: "Pen (P)" }).click();
  await drawLine(page, 0.97, 0.2, 0.4);
  await expect(canvas(page)).toHaveAttribute("data-user-strokes", "1");
  await undo(page);
  await expect(canvas(page)).toHaveAttribute("data-user-strokes", "0");
  await expect(pages(page)).toHaveCount(total);
  expect(Number(await attr(page, "data-ai-elements"))).toBeGreaterThan(0);
});

test("C: ink, AI content, page order and AI visibility persist across reload", async ({ page }) => {
  await mockAsk(page, SHORT_ANSWER);
  await open(page);
  await page.getByRole("button", { name: "Pen (P)" }).click();
  await drawLine(page, 0.9);
  await askAndInsert(page);
  await menuItem(page, "View", "Show AI layer");
  await expect(canvas(page)).toHaveAttribute("data-ai-visible", "false");
  await page.getByRole("button", { name: "+ Page" }).click();
  await pages(page).nth(0).getByRole("button").first().click();
  await expect(page.locator("header").getByRole("status")).toHaveText("Saved");

  const aiBefore = await attr(page, "data-ai-elements");
  await page.reload();
  await expect(canvas(page)).toBeVisible();
  await expect(pages(page)).toHaveCount(2);
  await pages(page).nth(0).getByRole("button").first().click();
  await expect(canvas(page)).toHaveAttribute("data-user-strokes", "1");
  await expect(canvas(page)).toHaveAttribute("data-ai-elements", aiBefore!);
  await expect(canvas(page)).toHaveAttribute("data-ai-visible", "false");
});

test("D: hide/show and clear AI content with undo/redo; user ink untouched", async ({ page }) => {
  await mockAsk(page, SHORT_ANSWER);
  await open(page);
  await page.getByRole("button", { name: "Pen (P)" }).click();
  await drawLine(page, 0.9);
  await askAndInsert(page);
  const ai = await attr(page, "data-ai-elements");

  await menuItem(page, "View", "Show AI layer");
  await expect(canvas(page)).toHaveAttribute("data-ai-visible", "false");
  await expect(canvas(page)).toHaveAttribute("data-ai-elements", ai!);
  await expect(canvas(page)).toHaveAttribute("data-user-strokes", "1");
  await undo(page);
  await expect(canvas(page)).toHaveAttribute("data-ai-visible", "true");
  await redo(page);
  await expect(canvas(page)).toHaveAttribute("data-ai-visible", "false");
  await menuItem(page, "View", "Show AI layer");
  await expect(canvas(page)).toHaveAttribute("data-ai-visible", "true");

  await menuItem(page, "View", "Clear AI content");
  await expect(canvas(page)).toHaveAttribute("data-ai-elements", "0");
  await expect(canvas(page)).toHaveAttribute("data-user-strokes", "1");
  await undo(page);
  await expect(canvas(page)).toHaveAttribute("data-ai-elements", ai!);
  await redo(page);
  await expect(canvas(page)).toHaveAttribute("data-ai-elements", "0");
  await expect(canvas(page)).toHaveAttribute("data-user-strokes", "1");
});
