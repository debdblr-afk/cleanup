import { axe, expect, noHorizontalScroll, startWithSample, test } from "./helpers";

test.describe("F06 accounts", () => {
  test("F06-N1 email login is off: /login goes home and there's no login button", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: /Log in|Save work/ })).toHaveCount(0);
    await page.goto("/account");
    await expect(page.getByText(/There are no logins/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Save my work|sign in/i })).toHaveCount(0);
  });

  test("F06-H2 delete my account removes everything", async ({ page }) => {
    await startWithSample(page);
    const batch = page.url();
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Your videos" })).toBeVisible();
    await page.getByRole("button", { name: "Delete my account" }).click();
    const dlg = page.getByRole("dialog", { name: "Delete your account?" });
    await expect(dlg.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dlg.getByRole("button", { name: "Delete", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/");
    await page.goto(batch);
    await expect(page.getByRole("heading", { name: "This batch isn't here" })).toBeVisible();
  });
});

test.describe("Every page at 390 px and 1440 px", () => {
  for (const path of ["/", "/enter", "/account", "/legal/terms", "/legal/privacy", "/legal/takedown", "/nope"]) {
    test(`X-E1 ${path} has no sideways scroll and passes axe`, async ({ page }) => {
      for (const w of [390, 1440]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await noHorizontalScroll(page);
        await axe(page);
      }
    });
  }
});

test("X-E2 the old pricing page sends you home", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Pricing" })).toHaveCount(0);
});
