import { chromium, type FullConfig } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const FIXTURES = path.join(__dirname, ".fixtures");

// No ffmpeg on this machine, so test clips are recorded in Chromium from a canvas,
// the same way the app's sample clip is made. Made once and cached.
const CLIPS = [
  { name: "clip-a.webm", seconds: 2, w: 640, h: 360, hue: 200 },
  { name: "clip-b.webm", seconds: 3, w: 960, h: 540, hue: 20 },
  { name: "clip-sound.webm", seconds: 3, w: 1280, h: 720, hue: 120, tone: true },
  // Just over a guest's 1-minute limit. Takes 62 s to record, once.
  { name: "long-62s.webm", seconds: 62, w: 160, h: 90, hue: 280 },
];

export default async function globalSetup(config: FullConfig) {
  mkdirSync(FIXTURES, { recursive: true });
  // Not a video at all, and a "video" that's random bytes.
  writeFileSync(path.join(FIXTURES, "notes.txt"), "just some text\n");
  writeFileSync(path.join(FIXTURES, "broken.mp4"), Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 256)));
  const missing = CLIPS.filter((c) => !existsSync(path.join(FIXTURES, c.name)));
  if (!missing.length) return;

  const baseURL = config.projects[0].use.baseURL!;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${baseURL}/legal/terms`);
  for (const c of missing) {
    const b64 = await page.evaluate(async ({ seconds, w, h, hue, tone }) => {
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      document.body.appendChild(canvas);
      const ctx = canvas.getContext("2d")!;
      const stream = canvas.captureStream(30);
      if (tone) {
        // A 440 Hz tone, so exports can be checked for sound.
        const ac = new AudioContext();
        const osc = ac.createOscillator();
        const dest = ac.createMediaStreamDestination();
        osc.connect(dest); osc.start();
        stream.addTrack(dest.stream.getAudioTracks()[0]);
      }
      const rec = new MediaRecorder(stream, { mimeType: tone ? "video/webm;codecs=vp8,opus" : "video/webm;codecs=vp8" });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const done = new Promise<void>((r) => (rec.onstop = () => r()));
      rec.start(100);
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        const tick = () => {
          const t = (performance.now() - t0) / 1000;
          ctx.fillStyle = `hsl(${hue + t * 20}, 50%, 45%)`;
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = "#fff";
          ctx.beginPath(); ctx.arc(w * (0.2 + 0.2 * t), h / 2, h / 6, 0, Math.PI * 2); ctx.fill();
          // A fixed "logo" in the corner for the detector to find.
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.fillRect(w - w / 5, h / 20, w / 6, h / 12);
          if (t < seconds) requestAnimationFrame(tick); else resolve();
        };
        tick();
      });
      rec.stop();
      await done;
      const buf = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
      let s = ""; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
      return btoa(s);
    }, c);
    writeFileSync(path.join(FIXTURES, c.name), Buffer.from(b64, "base64"));
  }
  await browser.close();
}
