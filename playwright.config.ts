import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against the local dev server and the local Supabase stack
// (`npm run db:start` first). Each test gets a fresh browser context, so a fresh guest.
const PORT = 5320;
// The tests read the same settings as the app (server or tab exports).
try { process.loadEnvFile(".env.local"); } catch { /* no local env */ }
const SERVER_EXPORTS = process.env.NEXT_PUBLIC_EXPORT_WORKER === "server";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/.report" }]],
  outputDir: "e2e/.results",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // Safari's engine. Run with: npx playwright test --project=safari
    { name: "safari", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    { command: `npm run dev -- --port ${PORT}`, url: `http://localhost:${PORT}`, reuseExistingServer: true, timeout: 120_000 },
    // The server worker renders exports; its health port tells Playwright it's up.
    ...(SERVER_EXPORTS ? [{ command: "npm run worker", url: "http://localhost:5399", reuseExistingServer: true, timeout: 60_000 }] : []),
  ],
});
