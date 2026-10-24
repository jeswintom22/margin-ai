import { defineConfig, devices } from "@playwright/test";

/**
 * Tutor walkthrough against `next dev` with the deterministic mock provider
 * (LLM_MOCK=true only works outside production). Exercises the real
 * /api/ask route, answer service and deterministic verification — no API key,
 * no provider calls. Stop any other `next dev` in this folder first (Next
 * allows one dev server per project directory).
 */
const PORT = 3200;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.mock\.spec\.ts/,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 180_000,
  // next dev compiles routes on first request; allow for it.
  expect: { timeout: 45_000 },
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 950 } } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { LLM_MOCK: "true", LLM_API_KEY: "" },
  },
});
