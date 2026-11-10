import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import ffmpeg from "ffmpeg-static";
import { parseProbe } from "../worker/plan.mjs";
import { axe, card, expect, startWithSample, test, uploadFiles, waitPreviewReady } from "./helpers";

const SERVER = process.env.NEXT_PUBLIC_EXPORT_WORKER === "server";
const EXT = SERVER ? "mp4" : "webm";
const probe = (file: string) => parseProbe(spawnSync(ffmpeg as unknown as string, ["-hide_banner", "-i", file]).stderr.toString());

test.describe("F02 export the full video", () => {
  test("F02-N1 a guest can export straight away, no plans or upsell", async ({ page }) => {
    await startWithSample(page);
    await waitPreviewReady(page, /sample/i);
    await card(page, /sample/i).getByRole("button", { name: "Export" }).click();
    const dlg = page.getByRole("dialog", { name: "Export video" });
    await expect(dlg.getByRole("button", { name: "Export 720p" })).toBeVisible();
    await expect(dlg.getByText(/See plans|Plus|Pro\b/)).toHaveCount(0);
    await expect(dlg).toContainText("Unlimited exports.");
    await axe(page);
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
  });

  test("F02-H1 on Plus: export 720p, download it, a second export is refused", async ({ page }) => {
    await startWithSample(page);
    await waitPreviewReady(page, /sample/i);
    await card(page, /sample/i).getByRole("button", { name: "Export" }).click();
    const dlg = page.getByRole("dialog", { name: "Export video" });
    // The sample is 720p, so 1080p, 2K and 4K are above the source.
    await expect(dlg.getByText("Above source")).toHaveCount(3);
    await expect(dlg).toContainText("Unlimited exports.");
    await dlg.getByRole("button", { name: "Export 720p" }).click();
    const link = dlg.getByRole("list", { name: "Exports" }).getByRole("link", { name: /^Download/ });
    await expect(link).toBeVisible({ timeout: 90_000 });
    const dl = page.waitForEvent("download");
    await link.click();
    const file = await dl;
    expect(file.suggestedFilename()).toMatch(new RegExp(`-cleaned-720p\\.${EXT}$`));
    expect(statSync(await file.path()).size).toBeGreaterThan(50_000);
    const info = probe(await file.path());
    expect(info.height).toBe(720);
    expect(info.durationMs).toBeGreaterThan(5000); // full length, not the 5 s preview
    await dlg.getByRole("button", { name: "Export 720p" }).click();
    await expect(dlg.getByRole("alert")).toContainText("already running or done");
  });

  test("F02-H3 server export keeps the sound and the page can be closed", async ({ page, context }) => {
    test.skip(!SERVER, "only with the server worker (NEXT_PUBLIC_EXPORT_WORKER=server)");
    await page.goto("/");
    await uploadFiles(page, ["clip-sound.webm"]);
    await page.waitForURL(/\/b\//);
    const batch = page.url();
    await waitPreviewReady(page, "clip-sound.webm");
    await card(page, "clip-sound.webm").getByRole("button", { name: "Export" }).click();
    const dlg = page.getByRole("dialog", { name: "Export video" });
    await expect(dlg).toContainText("render on our servers");
    await dlg.getByRole("button", { name: "Export 720p" }).click();
    await expect(dlg.getByRole("list", { name: "Exports" }).getByRole("listitem")).toHaveCount(1);
    // Close the page as soon as it's queued: the server finishes it anyway.
    await page.close();
    const again = await context.newPage();
    await again.goto(batch);
    await card(again, "clip-sound.webm").getByRole("button", { name: "Export" }).click();
    const link = again.getByRole("dialog", { name: "Export video" }).getByRole("list", { name: "Exports" }).getByRole("link", { name: /^Download/ });
    await expect(link).toBeVisible({ timeout: 90_000 });
    const dl = again.waitForEvent("download");
    await link.click();
    const file = await dl;
    expect(file.suggestedFilename()).toMatch(/-cleaned-720p\.mp4$/);
    const info = probe(await file.path());
    expect(info).toMatchObject({ height: 720, hasAudio: true });
  });

  test("F02-H4 the export keeps the original sound (tab or server)", async ({ page }) => {
    await page.goto("/");
    await uploadFiles(page, ["clip-sound.webm"]);
    await page.waitForURL(/\/b\//);
    await waitPreviewReady(page, "clip-sound.webm");
    await card(page, "clip-sound.webm").getByRole("button", { name: "Export" }).click();
    const dlg = page.getByRole("dialog", { name: "Export video" });
    await dlg.getByRole("button", { name: "Export 720p" }).click();
    const link = dlg.getByRole("list", { name: "Exports" }).getByRole("link", { name: /^Download/ });
    await expect(link).toBeVisible({ timeout: 90_000 });
    const dl = page.waitForEvent("download");
    await link.click();
    const file = await dl;
    expect(file.suggestedFilename()).toMatch(new RegExp(`-cleaned-720p\\.${EXT}$`));
    expect(probe(await file.path())).toMatchObject({ height: 720, hasAudio: true });
  });
});
