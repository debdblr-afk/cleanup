import type { Page } from "@playwright/test";
import { axe, card, expect, startWithSample, test, waitPreviewReady } from "./helpers";

async function openEditor(page: Page) {
  await startWithSample(page);
  await waitPreviewReady(page, /sample/i);
  await card(page, /sample/i).getByRole("link", { name: "Edit" }).click();
  await page.waitForURL(/\/edit$/);
  await expect(page.getByRole("toolbar", { name: "Zone tools" })).toBeVisible();
}

const zoneList = (page: Page) => page.getByRole("region", { name: "Zones" }).or(page.locator("section[aria-labelledby=zones-h]")).getByRole("listitem");
const stage = (page: Page) => page.getByLabel(/Video with zones/);

async function drawBox(page: Page, from: [number, number], to: [number, number]) {
  const box = (await stage(page).boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 8 });
  await page.mouse.up();
}

test.describe("F03 fix a missed watermark by hand", () => {
  test("F03-H1 draw an erase box, clean again, compare version 2", async ({ page }) => {
    await openEditor(page);
    await axe(page);
    const before = await zoneList(page).count();
    await drawBox(page, [0.4, 0.4], [0.55, 0.55]);
    await expect(zoneList(page)).toHaveCount(before + 1);
    await page.getByRole("button", { name: "Clean again" }).click();
    const versions = page.locator("section[aria-labelledby=versions-h]");
    await expect(versions.getByText("Version 2")).toBeVisible();
    await expect(versions.getByRole("listitem").first().getByRole("button", { name: "Compare" })).toBeVisible({ timeout: 90_000 });
    await versions.getByRole("listitem").first().getByRole("button", { name: "Compare" }).click();
    await expect(page.getByText("Version 2 · first 5 seconds")).toBeVisible();
    await page.getByRole("button", { name: "Back to editing" }).click();
    await expect(page.getByRole("toolbar", { name: "Zone tools" })).toBeVisible();
  });

  test("F03-E1 keyboard: select a zone, nudge it, delete it, undo", async ({ page }) => {
    await openEditor(page);
    await drawBox(page, [0.3, 0.3], [0.45, 0.45]);
    const n = await zoneList(page).count();
    const last = zoneList(page).nth(n - 1);
    await last.getByRole("button", { pressed: true }).or(last.getByRole("button").first()).first().click();
    await expect(stage(page)).toBeFocused();
    const label = await last.innerText();
    await page.keyboard.press("ArrowRight");
    await expect(zoneList(page).nth(n - 1)).not.toHaveText(label);
    await page.keyboard.press("Delete");
    await expect(zoneList(page)).toHaveCount(n - 1);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(zoneList(page)).toHaveCount(n);
  });

  test("F03-E2 a keep zone, chosen with K, is listed as keep", async ({ page }) => {
    await openEditor(page);
    await stage(page).focus();
    await page.keyboard.press("k");
    await expect(page.getByRole("button", { name: /Keep/ })).toHaveAttribute("aria-pressed", "true");
    await drawBox(page, [0.1, 0.6], [0.25, 0.8]);
    await expect(page.locator("section[aria-labelledby=zones-h]")).toContainText(/keep/i);
  });

  test("F03-N1 with no erase zone and auto off, cleaning is not possible", async ({ page }) => {
    await openEditor(page);
    const sw = page.getByRole("switch", { name: "Find it automatically" });
    if ((await sw.getAttribute("aria-checked")) === "true") await sw.click();
    // Delete every erase zone the auto pass left.
    for (let i = 0; i < 10; i++) {
      const del = page.getByRole("button", { name: /^Delete / }).first();
      if (!(await del.count())) break;
      await del.click();
    }
    await expect(page.getByText(/Draw at least one erase box/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Clean again" })).toBeDisabled();
  });
});
