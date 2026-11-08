import { expect, test } from "./helpers";

// Runs only when the passcode gate is on (SITE_PASSCODE set for the dev server and the tests).
const CODE = process.env.SITE_PASSCODE;

test.describe("Passcode gate", () => {
  test.skip(!CODE, "gate is off (no SITE_PASSCODE)");

  test("GATE-1 every page sends you to the passcode page, and back after entering", async ({ page }) => {
    await page.goto("/account");
    await expect(page).toHaveURL(/\/enter\?next=%2Faccount$/);
    await expect(page.getByRole("heading", { name: "Enter the passcode" })).toBeVisible();
    // Nothing behind the gate shows on the passcode page.
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
    await page.getByLabel("Passcode").fill(CODE!);
    await page.getByRole("button", { name: "Enter" }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("heading", { name: "Your videos" })).toBeVisible();
  });

  test("GATE-2 a wrong passcode is refused and nothing opens", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/enter$/);
    await page.getByLabel("Passcode").fill("not-the-code");
    await page.getByRole("button", { name: "Enter" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "That passcode isn't right." })).toBeVisible();
    await page.goto("/legal/privacy");
    await expect(page).toHaveURL(/\/enter/);
  });

  test("GATE-3 the API refuses without the passcode; machine routes keep their own checks", async ({ request }) => {
    const api = await request.post("/api/batches");
    expect(api.status()).toBe(401);
    expect((await api.json()).error.code).toBe("passcode");
    const cron = await request.get("/api/cron/expire");
    expect(cron.status()).toBe(401); // refused by CRON_SECRET, not by the gate
    expect((await cron.json()).error.code).not.toBe("passcode");
    const icon = await request.get("/icon.svg");
    expect(icon.status()).toBe(200);
  });

  test("GATE-4 a forged cookie doesn't open the site", async ({ page, context }) => {
    await context.addCookies([{ name: "cleanup_gate", value: "forged-value", url: "http://localhost:5320" }]);
    await page.goto("/");
    await expect(page).toHaveURL(/\/enter$/);
  });
});
