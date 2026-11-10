import { copyFileSync, statSync } from "node:fs";
import { attestBox, axe, card, enterGate, expect, fixture, noHorizontalScroll, startWithSample, test, uploadFiles, waitPreviewReady } from "./helpers";

test.describe("F01 guest cleans a video and grabs the free preview", () => {
  test("F01-H1 sample clip → preview ready → download the 5 s preview", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await axe(page);
    await startWithSample(page);
    await expect(page.getByRole("heading", { name: /^Batch from/ })).toBeVisible();
    await waitPreviewReady(page, /sample/i);
    await axe(page);
    const dl = page.waitForEvent("download");
    await card(page, /sample/i).getByRole("link", { name: /Download 5 second preview/ }).click();
    const file = await dl;
    expect(file.suggestedFilename()).toMatch(/-cleaned-5s\.webm$/);
    const size = statSync(await file.path()).size;
    expect(size).toBeGreaterThan(20_000);
  });

  test("F01-H4 the cleaned preview actually plays in this browser (BUG-014)", async ({ page }) => {
    await startWithSample(page);
    await waitPreviewReady(page, /sample/i);
    // Both players on the card (original and cleaned) must load without a media error.
    await expect.poll(async () => page.evaluate(() => [...document.querySelectorAll<HTMLVideoElement>("article video")].map((v) => ({
      ok: !v.error && v.readyState >= 2 && v.videoWidth > 0, error: v.error?.code ?? null,
    }))), { timeout: 20_000 }).toEqual([{ ok: true, error: null }, { ok: true, error: null }]);
  });

  test("F01-H2 upload your own file with the rights box ticked", async ({ page }) => {
    await page.goto("/");
    await uploadFiles(page, ["clip-a.webm"]);
    await page.waitForURL(/\/b\//);
    await waitPreviewReady(page, "clip-a.webm");
    await expect(card(page, "clip-a.webm")).toContainText("360p");
  });

  test("F01-N1 no rights box while the site is in testing: a video uploads straight away", async ({ page }) => {
    await page.goto("/");
    await expect(attestBox(page)).toHaveCount(0);
    await expect(page.getByText(/I own these videos/)).toHaveCount(0);
    await uploadFiles(page, ["clip-a.webm"]);
    await page.waitForURL(/\/b\//);
    await expect(card(page, "clip-a.webm")).toBeVisible();
  });

  test("F01-N2 a text file is refused with a clear message", async ({ page }) => {
    await page.goto("/");
    await uploadFiles(page, ["notes.txt"]);
    await expect(page.getByRole("alert").filter({ hasText: "isn't a video we can open" })).toBeVisible();
  });

  test("F01-N3 a damaged video is refused with a clear message", async ({ page }) => {
    await page.goto("/");
    await uploadFiles(page, ["broken.mp4"]);
    await expect(page.getByRole("alert").filter({ hasText: "couldn't be opened" })).toBeVisible();
  });

  test("F01-H3 a video over a minute is accepted: everyone gets up to 30 minutes", async ({ page }) => {
    await page.goto("/");
    await uploadFiles(page, ["long-62s.webm"]);
    await page.waitForURL(/\/b\//);
    await expect(card(page, "long-62s.webm")).toContainText("1:02");
    await waitPreviewReady(page, "long-62s.webm");
  });

  test("F01-E1 a second visitor can't see the batch or its files", async ({ page, browser }) => {
    await startWithSample(page);
    await waitPreviewReady(page, /sample/i);
    const batchUrl = page.url();
    const previewHref = await card(page, /sample/i).getByRole("link", { name: /Download 5 second preview/ }).getAttribute("href");
    const other = await browser.newContext();
    const p2 = await other.newPage();
    await enterGate(p2); // the second visitor knows the passcode but isn't the owner
    await p2.goto(batchUrl);
    await expect(p2.getByRole("heading", { name: "This batch isn't here" })).toBeVisible();
    // No logins: videos belong to the browser that added them, and the page says so.
    await expect(p2.getByText(/made in another browser/)).toBeVisible();
    const res = await p2.request.get(previewHref!, { maxRedirects: 0 });
    expect([401, 403, 404]).toContain(res.status());
    await other.close();
  });

  test("F01-E2a refresh while it's uploading: the card says so and can be removed (BUG-002)", async ({ page }) => {
    // Hold the upload open so the refresh lands mid-upload.
    await page.route("**/storage/v1/object/upload/sign/**", () => { /* never answer */ });
    await startWithSample(page);
    await expect(card(page, /sample/i).getByText("Saving the file")).toBeVisible();
    await page.unroute("**/storage/v1/object/upload/sign/**");
    await page.reload();
    const c = card(page, /sample/i);
    await expect(c.getByText("Upload stopped")).toBeVisible({ timeout: 45_000 });
    await c.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(page.getByText(/0 of 30 videos/)).toBeVisible();
  });

  test("F01-E2b refresh while it's cleaning: the card still finishes (BUG-003)", async ({ page }, info) => {
    // Reloading mid-request makes Safari report the cancelled requests this way.
    info.annotations.push({ type: "allow-console", description: "due to access control checks|Load failed|cancelled" });
    await startWithSample(page);
    await expect(card(page, /sample/i).getByText(/Finding the watermark|Cleaning the 5 s preview/).first()).toBeVisible({ timeout: 60_000 });
    await page.reload();
    await waitPreviewReady(page, /sample/i);
  });

  test("F01-E3 cancel while cleaning, then try again", async ({ page }) => {
    await page.goto("/");
    await uploadFiles(page, ["clip-b.webm"]);
    await page.waitForURL(/\/b\//);
    const c = card(page, "clip-b.webm");
    await c.getByRole("button", { name: "Cancel" }).click({ timeout: 30_000 });
    await expect(c.getByText("Canceled")).toBeVisible();
    await c.getByRole("button", { name: "Try again" }).click();
    await waitPreviewReady(page, "clip-b.webm");
  });

  test("F01-E3b cancel in the last moments of cleaning: the card says Canceled (BUG-010)", async ({ page }) => {
    await startWithSample(page);
    const c = card(page, /sample/i);
    await expect(c.getByText(/Cleaning the 5 s preview · (8\d|9\d)%/)).toBeVisible({ timeout: 60_000 });
    await c.getByRole("button", { name: "Cancel" }).click();
    await expect(c.getByText(/^(Canceled|Preview ready)$/)).toBeVisible();
    await page.waitForTimeout(3000);
    await expect(c.getByText(/Cleaning the 5 s preview/)).toHaveCount(0);
  });

  test("F01-E3c Try again refused by the server: a message, the real state, no crash (BUG-011)", async ({ page }) => {
    await page.goto("/");
    await uploadFiles(page, ["clip-b.webm"]);
    await page.waitForURL(/\/b\//);
    const c = card(page, "clip-b.webm");
    await c.getByRole("button", { name: "Cancel" }).click({ timeout: 30_000 });
    await expect(c.getByText("Canceled")).toBeVisible();
    await page.route("**/api/jobs/*/retry", (r) => r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "not_finished", message: "Only failed or canceled jobs can be retried." } }) }));
    await c.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText(/Couldn.t start it again/)).toBeVisible();
    await expect(c.getByText("Canceled")).toBeVisible();
  });

  test("F01-E4 a 70-character name with accents and emoji fits its card at 390 px", async ({ page }, info) => {
    const long = "Été à Montréal 🎬 démo finale v2 – coupe longue pour Instagram et TikTok.webm";
    const target = info.outputPath(long);
    copyFileSync(fixture("clip-a.webm"), target);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await noHorizontalScroll(page);
    await page.locator('input[type="file"]').first().setInputFiles(target);
    await page.waitForURL(/\/b\//);
    await expect(card(page, long)).toBeVisible();
    await noHorizontalScroll(page);
    await waitPreviewReady(page, long);
    await noHorizontalScroll(page);
    await axe(page);
  });

  test("F01-E6 keyboard only: start the sample", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "Safari only tabs to form controls when 'Press Tab to highlight each item' is on");
    await page.goto("/");
    const sample = page.getByRole("button", { name: /Try a sample/ });
    for (let i = 0; i < 25 && !(await sample.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(sample).toBeFocused();
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/b\//, { timeout: 60_000 });
  });

  test("F01-E7 double click on the sample button makes one video", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Try a sample/ }).dblclick();
    await page.waitForURL(/\/b\//, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    await expect(page.getByRole("article")).toHaveCount(1);
  });
});

test("F01-E8 the landing FAQ describes where files really go (BUG-005)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/never uploaded/)).toHaveCount(0);
  await expect(page.getByText(/private storage that only your account can reach/)).toBeAttached();
});
