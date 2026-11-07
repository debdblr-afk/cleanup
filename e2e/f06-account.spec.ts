import { axe, expect, latestLinkFor, noHorizontalScroll, startWithSample, test, waitPreviewReady } from "./helpers";

test.describe("F06 accounts", () => {
  test("F06-N1 a malformed email is refused on the page", async ({ page }) => {
    await page.goto("/login");
    await axe(page);
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Email me a link" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Enter a full email address" })).toBeVisible();
  });

  test("F06-N2 an expired or used link says so", async ({ page }) => {
    await page.goto("/login?error=link");
    await expect(page.getByRole("alert").filter({ hasText: "expired or was already used" })).toBeVisible();
  });

  test("F06-N3 Google not configured: no Google button, no raw error page (BUG-006)", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Email me a link" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  });

  test("F06-H1 guest adds an email, confirms it, keeps the batch, signs out", async ({ page }, info) => {
    info.annotations.push({ type: "allow-5xx", description: "/api/billing/checkout" });
    const email = `e2e-${Date.now()}@example.test`;
    await startWithSample(page);
    const batch = page.url();
    await waitPreviewReady(page, /sample/i);
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Email me a link" }).click();
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
    await page.goto(await latestLinkFor(email));
    await page.waitForURL(/\/account/);
    await expect(page.getByRole("main").getByText(email)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Plan: Free" })).toBeVisible();
    await page.goto(batch);
    await waitPreviewReady(page, /sample/i);

    // BUG-009: the signed-in email in the header must fit a 375 px phone.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/pricing");
    await expect(page.getByRole("button", { name: "Open menu" })).toBeInViewport({ ratio: 1 });
    await noHorizontalScroll(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    // Signed in, no Stripe key on this machine: checkout says so instead of failing.
    await page.goto("/pricing");
    await page.getByRole("button", { name: "Choose Plus" }).click();
    await expect(page.getByText(/aren.t set up/i)).toBeVisible();

    await page.goto("/account");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/");
    await page.goto(batch);
    await expect(page.getByRole("heading", { name: "This batch isn't here" })).toBeVisible();
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
  for (const path of ["/", "/pricing", "/login", "/account", "/legal/terms", "/legal/privacy", "/legal/takedown", "/nope"]) {
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
