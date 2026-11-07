import { attestBox, card, expect, startWithSample, test, uploadFiles, waitPreviewReady } from "./helpers";

test.describe("F01 network and session edge cases", () => {
  test("F01-E9 offline: adding a video fails with a message, nothing crashes", async ({ page, context }) => {
    await page.goto("/");
    await attestBox(page).check();
    await page.waitForLoadState("networkidle");
    await context.setOffline(true);
    await uploadFiles(page, ["clip-a.webm"]);
    await expect(page.getByRole("alert").filter({ hasText: /./ }).first()).toBeVisible({ timeout: 20_000 });
    expect(page.url()).not.toMatch(/\/b\//);
    await context.setOffline(false);
    await uploadFiles(page, ["clip-a.webm"]);
    await page.waitForURL(/\/b\//);
  });

  test("F01-E10 slow network: a 3G-speed upload still lands", async ({ page, context }) => {
    const cdp = await context.newCDPSession(page);
    await page.goto("/");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 300, downloadThroughput: 200_000, uploadThroughput: 100_000 });
    await attestBox(page).check();
    await uploadFiles(page, ["clip-a.webm"]);
    await page.waitForURL(/\/b\//, { timeout: 60_000 });
    await expect(card(page, "clip-a.webm").getByText("Saving the file")).toBeVisible();
    await waitPreviewReady(page, "clip-a.webm");
  });

  test("F01-E11 session cookies cleared mid-flow: the old batch is gone, the next action works", async ({ page, context }) => {
    await startWithSample(page);
    await waitPreviewReady(page, /sample/i);
    const batch = page.url();
    await context.clearCookies();
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByRole("heading", { name: "This batch isn't here" })).toBeVisible();
    await page.getByRole("link", { name: "Start a new batch" }).click();
    await attestBox(page).check();
    await uploadFiles(page, ["clip-a.webm"]);
    await page.waitForURL((u) => /\/b\//.test(u.pathname) && u.href !== batch);
    await waitPreviewReady(page, "clip-a.webm");
  });
});
