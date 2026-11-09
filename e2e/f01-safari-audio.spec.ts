import { card, expect, startWithSample, test, waitPreviewReady } from "./helpers";

// BUG-013: real Safari leaves AudioContext.resume() pending forever unless it's called right
// after a click. A clean that started on its own (the next job in the queue) waited on it and
// never finished, and the tab stopped taking work. Simulate Safari's behaviour in any browser.
test.describe("F01 Safari audio policy", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const P = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext).prototype;
      Object.defineProperty(P, "state", { get: () => "suspended", configurable: true });
      P.resume = () => new Promise<void>(() => {}); // never settles, like Safari without a gesture
    });
  });

  test("F01-E12 cleaning still finishes when the browser won't start audio, and the next job runs too", async ({ page }) => {
    await startWithSample(page);
    await waitPreviewReady(page, /sample/i);
    // A second job that starts on its own after the first: the tab must still take it.
    await card(page, /sample/i).getByRole("link", { name: "Edit" }).click();
    await page.waitForURL(/\/edit$/);
    await page.getByRole("button", { name: "Clean again" }).click();
    const versions = page.locator("section[aria-labelledby=versions-h]");
    await expect(versions.getByRole("listitem").first().getByRole("button", { name: "Compare" })).toBeVisible({ timeout: 90_000 });
  });
});
