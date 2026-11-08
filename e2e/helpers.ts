import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";
import path from "node:path";

export const fixture = (name: string) => path.join(__dirname, ".fixtures", name);

/** With the passcode gate on, enter it for this page's browser context (new contexts, cleared cookies). */
export async function enterGate(page: Page) {
  if (process.env.SITE_PASSCODE) await page.request.post("/api/enter", { data: { passcode: process.env.SITE_PASSCODE } });
}

/**
 * Every test fails on a console error from the app or any 5xx response.
 * Expected 4xx answers (a refused export, a signed-out file request) log a
 * "Failed to load resource" line in Chromium; those are left to the test to assert.
 */
export const test = base.extend<{ guard: void }>({
  guard: [async ({ page }, use, info) => {
    // With the passcode gate on (SITE_PASSCODE set), enter it once so the test starts inside.
    if (process.env.SITE_PASSCODE && !info.title.startsWith("GATE")) {
      await page.request.post("/api/enter", { data: { passcode: process.env.SITE_PASSCODE } });
    }
    const problems: string[] = [];
    // A test can allow a known 5xx with test.info().annotations.push({ type: "allow-5xx", description: "/api/..." }).
    const allowed = (url: string) => info.annotations.some((a) => a.type === "allow-5xx" && a.description && url.includes(a.description));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const text = m.text();
      if (/Failed to load resource: the server responded with a status of 4\d\d/.test(text)) return;
      if (/net::ERR_INTERNET_DISCONNECTED/.test(text)) return; // the offline case, asserted by its test
      if (/Failed to load resource/.test(text) && allowed(m.location().url)) return;
      problems.push(`console: ${text}`);
    });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("response", (r) => { if (r.status() >= 500 && !allowed(r.url())) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
    await use();
    expect(problems, "console errors or 5xx responses").toEqual([]);
  }, { auto: true }],
});
export { expect };

/** axe scan, WCAG 2.x A and AA. */
export async function axe(page: Page, exclude: string[] = []) {
  let b = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  for (const sel of exclude) b = b.exclude(sel);
  const r = await b.analyze();
  const summary = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length}x ${v.nodes[0]?.target.join(" ")}`);
  expect(summary, "axe violations").toEqual([]);
}

export async function noHorizontalScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, "page scrolls sideways").toBeLessThanOrEqual(0);
}

export const attestBox = (page: Page) => page.getByRole("checkbox", { name: /I own these videos/ });

/** S01 → "Try a sample" → lands on the new batch page. */
export async function startWithSample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Try a sample/ }).click();
  await page.waitForURL(/\/b\/[0-9a-f-]{36}$/, { timeout: 60_000 });
}

export async function uploadFiles(page: Page, files: string[]) {
  await page.locator('input[type="file"]').first().setInputFiles(files.map(fixture));
}

export const card = (page: Page, filename: string | RegExp) => page.getByRole("article", { name: filename });

export async function waitPreviewReady(page: Page, filename: string | RegExp) {
  await expect(card(page, filename).getByText("Preview ready")).toBeVisible({ timeout: 90_000 });
}


export const MAILPIT = "http://127.0.0.1:55324";

export async function latestLinkFor(email: string): Promise<string> {
  // Only an email sent to exactly this address counts: Mailpit's search is loose, and an older
  // message to a similar test address carries a link that was already used.
  for (let i = 0; i < 30; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=5`)).json();
    const hit = (list.messages ?? []).find((m: { To?: { Address: string }[] }) => m.To?.some((t) => t.Address.toLowerCase() === email.toLowerCase()));
    if (hit) {
      const msg = await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json();
      const m = String(msg.HTML || msg.Text).match(/href="([^"]+)"/) ?? String(msg.Text).match(/(https?:\/\/\S+)/);
      if (m) return m[1].replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`no email for ${email}`);
}
