import { attestBox, axe, card, expect, test, uploadFiles, waitPreviewReady } from "./helpers";

test.describe("F04 clean several videos in one batch", () => {
  test("F04-H1 two files at once, two cards, both finish; add a third from the tile", async ({ page }) => {
    await page.goto("/");
    await attestBox(page).check();
    await uploadFiles(page, ["clip-a.webm", "clip-b.webm"]);
    await page.waitForURL(/\/b\//);
    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(page.getByText(/2 of 30 videos/)).toBeVisible();
    await waitPreviewReady(page, "clip-a.webm");
    await waitPreviewReady(page, "clip-b.webm");
    await page.locator('input[type="file"]').first().setInputFiles([]); // reset
    await page.locator('input[type="file"]').last().setInputFiles(["e2e/.fixtures/clip-a.webm"]);
    await expect(page.getByRole("article")).toHaveCount(3);
    await expect(page.getByText(/3 of 30 videos/)).toBeVisible();
    await axe(page);
  });

  test("F04-E1 one bad file among good ones: the good one is added, the bad one is reported", async ({ page }) => {
    await page.goto("/");
    await attestBox(page).check();
    await uploadFiles(page, ["clip-a.webm", "broken.mp4"]);
    await page.waitForURL(/\/b\//);
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByText(/broken\.mp4 couldn't be opened/)).toBeVisible();
  });

  test("F04-E2 remove a video from the batch", async ({ page }) => {
    await page.goto("/");
    await attestBox(page).check();
    await uploadFiles(page, ["clip-a.webm", "clip-b.webm"]);
    await page.waitForURL(/\/b\//);
    await waitPreviewReady(page, "clip-a.webm");
    await card(page, "clip-a.webm").getByRole("button", { name: /More actions/ }).click();
    await page.getByRole("menuitem", { name: "Remove from batch" }).click();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByText(/1 of 30 videos/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("article")).toHaveCount(1);
  });

  test("F04-E3 the same batch open in two tabs stays in sync", async ({ page, context }) => {
    await page.goto("/");
    await attestBox(page).check();
    await uploadFiles(page, ["clip-a.webm"]);
    await page.waitForURL(/\/b\//);
    const second = await context.newPage();
    await second.goto(page.url());
    await expect(second.getByRole("article")).toHaveCount(1);
    await page.locator('input[type="file"]').last().setInputFiles(["e2e/.fixtures/clip-b.webm"]);
    await expect(second.getByRole("article")).toHaveCount(2);
    await waitPreviewReady(second, "clip-b.webm");
    await waitPreviewReady(page, "clip-b.webm");
  });
});
