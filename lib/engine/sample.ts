// "No video handy?" A short clip drawn on a canvas right here: a moving scene with two
// made-up watermarks burned in. Our own pixels, so there is nothing to license, and it gives
// first-time visitors (and tests) something to clean in one click.

import { pickRecorderType, extensionFor } from "./video";

export async function makeSampleClip(seconds = 6, onProgress?: (pct: number) => void): Promise<File> {
  const type = pickRecorderType();
  if (!type) throw new Error("This browser can't record video. Try Chrome, Edge or Firefox.");
  const W = 1280, H = 720;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;

  const draw = (t: number) => {
    // Sky drifting from dawn to day.
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, `hsl(${205 + 10 * Math.sin(t * 0.6)}, 60%, ${46 + 6 * Math.sin(t * 0.4)}%)`);
    sky.addColorStop(1, `hsl(${30 + 8 * Math.sin(t * 0.5)}, 70%, 72%)`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    // Sun crossing the sky.
    ctx.fillStyle = "rgba(255, 236, 170, 0.95)";
    ctx.beginPath();
    ctx.arc(160 + t * 150, 190 - 40 * Math.sin(t * 0.5), 64, 0, Math.PI * 2);
    ctx.fill();
    // Three layers of hills scrolling at different speeds.
    const layers = [
      { y: 470, amp: 50, speed: 40, col: "hsl(150, 25%, 42%)", f: 0.006 },
      { y: 540, amp: 40, speed: 90, col: "hsl(140, 30%, 32%)", f: 0.009 },
      { y: 620, amp: 30, speed: 160, col: "hsl(130, 35%, 22%)", f: 0.013 },
    ];
    for (const l of layers) {
      ctx.fillStyle = l.col;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 16) ctx.lineTo(x, l.y + l.amp * Math.sin((x + t * l.speed) * l.f));
      ctx.lineTo(W, H);
      ctx.fill();
    }
    // Made-up watermarks: a handle bottom right and a tag top left.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 6;
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.font = "700 46px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("yourbrand.tv", W - 48, H - 48);
    ctx.font = "700 26px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("● SAMPLE", 40, 62);
    ctx.restore();
  };

  draw(0);
  const stream = c.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 5_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((r) => { rec.onstop = () => r(); });
  rec.start(250);
  const start = performance.now();
  await new Promise<void>((resolve) => {
    const frame = () => {
      const t = (performance.now() - start) / 1000;
      draw(t);
      onProgress?.(Math.min(99, Math.round((t / seconds) * 100)));
      if (t >= seconds) return resolve();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  rec.stop();
  await stopped;
  onProgress?.(100);
  const base = type.split(";")[0];
  return new File(chunks, `sample-hills.${extensionFor(base)}`, { type: base });
}
