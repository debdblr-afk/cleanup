import { statSync } from "node:fs";
import { axe, card, expect, setDemoPlan, startWithSample, test, waitPreviewReady } from "./helpers";

test.describe("F02 export the full video", () => {
  test("F02-N1 a guest sees the plans, not an export button", async ({ page }) => {
    await startWithSample(page);
    await waitPreviewReady(page, /sample/i);
    await card(page, /sample/i).getByRole("button", { name: "Export" }).click();
    const dlg = page.getByRole("dialog", { name: "Export video" });
    await expect(dlg).toContainText("Full-length exports are on Plus and Pro");
    await expect(dlg.getByRole("link", { name: "See plans" })).toBeVisible();
    await expect(dlg.getByRole("button", { name: /^Export / })).toHaveCount(0);
    await expect(dlg.getByRole("link", { name: "Download 5 s preview" })).toBeVisible();
    await axe(page);
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
  });

  test("F02-H1 on Plus: export 720p, download it, a second export is refused", async ({ page }) => {
    await startWithSample(page);
    const batch = page.url();
    await waitPreviewReady(page, /sample/i);
    await setDemoPlan(page, "Plus");
    await page.goto(batch);
    await card(page, /sample/i).getByRole("button", { name: "Export" }).click();
    const dlg = page.getByRole("dialog", { name: "Export video" });
    // Plus tops out at 1080p; the sample is 720p so 1080p is above the source.
    await expect(dlg.getByText("Above source")).toBeVisible();
    await expect(dlg.getByText("Pro")).toHaveCount(2);
    await expect(dlg).toContainText("10 of 10 exports left today");
    await dlg.getByRole("button", { name: "Export 720p" }).click();
    const link = dlg.getByRole("list", { name: "Exports" }).getByRole("link", { name: /^Download/ });
    await expect(link).toBeVisible({ timeout: 90_000 });
    const dl = page.waitForEvent("download");
    await link.click();
    const file = await dl;
    expect(file.suggestedFilename()).toMatch(/-cleaned-720p\.webm$/);
    expect(statSync(await file.path()).size).toBeGreaterThan(50_000);
    await dlg.getByRole("button", { name: "Export 720p" }).click();
    await expect(dlg.getByRole("alert")).toContainText("already running or done");
    await expect(dlg).toContainText("9 of 10 exports left today");
  });

  test("F02-N2 choosing a paid plan as a guest asks you to sign in first", async ({ page }) => {
    await page.goto("/pricing");
    await axe(page);
    await page.getByRole("radio", { name: /Yearly/ }).click();
    await page.getByRole("button", { name: "Choose Plus" }).click();
    await page.waitForURL(/\/login\?next=/);
    expect(decodeURIComponent(page.url())).toContain("/pricing");
    await expect(page.getByRole("button", { name: "Email me a link" })).toBeVisible();
  });
});
