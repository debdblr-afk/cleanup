// Smoke test for the built Mac app: node smoke.mjs (after npm run dist, with the local copy running).
import { _electron as electron, expect } from "@playwright/test";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const exe = path.join(here, "dist/mac-arm64/Cleanup.app/Contents/MacOS/Cleanup");
const problems = [];

// 1. With the local copy running, the app opens it and cleans the sample clip.
let app = await electron.launch({ executablePath: exe });
let win = await app.firstWindow();
win.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
win.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) problems.push(`console: ${m.text()}`); });
await win.waitForURL(/localhost:5320/, { timeout: 20_000 });
console.log("opened", win.url(), "title:", await win.title());
await win.getByRole("button", { name: /Try a sample/ }).click();
await win.waitForURL(/\/b\//, { timeout: 60_000 });
await expect(win.getByRole("article").getByText("Preview ready")).toBeVisible({ timeout: 90_000 });
console.log("sample cleaned inside the app");
// External links leave the app instead of navigating it.
const before = win.url();
await win.evaluate(() => { const a = document.createElement("a"); a.href = "https://example.com/"; a.target = "_blank"; document.body.appendChild(a); a.click(); });
await win.waitForTimeout(500);
if (app.windows().length !== 1 || win.url() !== before) problems.push("an external link opened inside the app");
await app.close();

// 2. Nothing reachable: the offline page with a working Try again button.
app = await electron.launch({ executablePath: exe, env: { ...process.env, CLEANUP_URL: "http://localhost:5999" } });
win = await app.firstWindow();
await expect(win.getByRole("heading", { name: "Cleanup isn't reachable" })).toBeVisible({ timeout: 15_000 });
await win.getByRole("button", { name: "Try again" }).click();
await expect(win.getByRole("button", { name: "Try again" })).toBeEnabled({ timeout: 15_000 });
console.log("offline page ok");
await app.close();

if (problems.length) { console.error("PROBLEMS:\n" + problems.join("\n")); process.exit(1); }
console.log("smoke test passed");
