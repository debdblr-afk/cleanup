// Builds build/icon.icns from the web app's icon (app/icon.svg), with the margin macOS app
// icons use. Renders with the Playwright Chromium the tests already install; packs with iconutil.
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const svg = readFileSync(path.join(here, "../app/icon.svg"), "utf8");
const set = path.join(here, "build/icon.iconset");
rmSync(set, { recursive: true, force: true });
mkdirSync(set, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  const inner = Math.round(size * 0.8);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:transparent">
    <div style="width:${inner}px;height:${inner}px;filter:drop-shadow(0 ${size * 0.01}px ${size * 0.02}px rgba(0,0,0,.25))">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  const png = await page.screenshot({ omitBackground: true });
  const write = (name) => import("node:fs").then((fs) => fs.writeFileSync(path.join(set, name), png));
  if (size <= 512) await write(`icon_${size}x${size}.png`);
  if (size >= 32) await write(`icon_${size / 2}x${size / 2}@2x.png`);
}
await browser.close();
execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(here, "build/icon.icns")]);
rmSync(set, { recursive: true, force: true });
console.log("build/icon.icns written");
