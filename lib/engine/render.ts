// Renders a cleaned copy of a video in the browser: plays it (muted) into a canvas, fills
// every active erase region each frame, and records the canvas. Stand-in for the GPU
// worker's render(preview | full); same inputs (video, mask, limits) and output (a file).
// Audio is not carried over here; the worker re-muxes the original audio.

import { activeAt, rasterizeBrush, toPixels } from "../mask";
import type { Mask } from "../types";
import { fillMask, fillRect } from "./inpaint";
import { disposeVideo, loadVideo, pickRecorderType } from "./video";

export type RenderOptions = {
  limitMs: number | null; // null = whole video
  maxHeight: number;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
};

export type RenderResult = { blob: Blob; durationMs: number; width: number; height: number };

export class RenderError extends Error {
  constructor(public code: "unsupported_browser" | "render_failed" | "canceled", message: string) {
    super(message);
  }
}

export async function render(source: Blob, mask: Mask, opts: RenderOptions): Promise<RenderResult> {
  const type = pickRecorderType();
  if (!type || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
    throw new RenderError("unsupported_browser", "This browser can't record video. Try Chrome, Edge or Firefox.");
  }
  const url = URL.createObjectURL(source);
  let video: HTMLVideoElement | null = null;
  try {
    video = await loadVideo(url);
    const v = video;
    const scale = Math.min(1, opts.maxHeight / v.videoHeight);
    // H.264/VP9 want even dimensions.
    const width = Math.max(2, Math.round((v.videoWidth * scale) / 2) * 2);
    const height = Math.max(2, Math.round((v.videoHeight * scale) / 2) * 2);
    const endS = opts.limitMs == null ? v.duration : Math.min(v.duration, opts.limitMs / 1000);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    const erase = mask.regions.filter((r) => r.kind === "erase");
    const protect = mask.regions.filter((r) => r.kind === "protect");

    const drawFrame = () => {
      ctx.drawImage(v, 0, 0, width, height);
      const tMs = v.currentTime * 1000;
      const active = erase.filter((r) => activeAt(r, tMs));
      if (!active.length) return;
      const keep = protect.filter((r) => activeAt(r, tMs)).map((r) => toPixels(r, width, height));
      const isProtected = keep.length
        ? (x: number, y: number) => keep.some((k) => x >= k.x0 && x < k.x1 && y >= k.y0 && y < k.y1)
        : undefined;
      for (const r of active) {
        if (r.shape === "brush") { fillBrush(r); continue; }
        const px = toPixels(r, width, height);
        // Read a margin around the box so fillRect can sample the pixels just outside it.
        const m = 4;
        const sx = Math.max(0, px.x0 - m), sy = Math.max(0, px.y0 - m);
        const sw = Math.min(width, px.x1 + m) - sx, sh = Math.min(height, px.y1 + m) - sy;
        const img = ctx.getImageData(sx, sy, sw, sh);
        fillRect(
          img.data, sw, sh,
          { x0: px.x0 - sx, y0: px.y0 - sy, x1: px.x1 - sx, y1: px.y1 - sy },
          isProtected ? (x, y) => isProtected(x + sx, y + sy) : undefined,
        );
        ctx.putImageData(img, sx, sy);
      }
    };

    // A brush stroke: fill exactly the painted pixels (minus keep areas) inside its box.
    function fillBrush(r: (typeof erase)[number]) {
      const tMs = video!.currentTime * 1000;
      const keep = protect.filter((k) => activeAt(k, tMs)).map((k) => toPixels(k, width, height));
      const { bits, x0, y0, x1, y1 } = rasterizeBrush(r, width, height);
      const m = 4;
      const sx = Math.max(0, x0 - m), sy = Math.max(0, y0 - m);
      const sw = Math.min(width, x1 + m) - sx, sh = Math.min(height, y1 + m) - sy;
      if (sw <= 0 || sh <= 0) return;
      const local = new Uint8Array(sw * sh);
      const bw = x1 - x0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        if (!bits[(y - y0) * bw + (x - x0)]) continue;
        if (keep.some((k) => x >= k.x0 && x < k.x1 && y >= k.y0 && y < k.y1)) continue;
        local[(y - sy) * sw + (x - sx)] = 1;
      }
      const img = ctx.getImageData(sx, sy, sw, sh);
      fillMask(img.data, sw, sh, local);
      ctx.putImageData(img, sx, sy);
    }

    // First frame before recording starts, so the file doesn't open on black.
    drawFrame();
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: height >= 1080 ? 8_000_000 : 4_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      v.pause();
      if (recorder.state !== "inactive") recorder.stop();
    };

    const onAbort = () => finish();
    opts.signal?.addEventListener("abort", onAbort);

    const hasRvfc = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
    const tick = () => {
      if (finished) return;
      drawFrame();
      opts.onProgress?.(Math.min(99, Math.round((v.currentTime / endS) * 100)));
      if (v.currentTime >= endS - 0.001 || v.ended) return finish();
      if (hasRvfc) v.requestVideoFrameCallback(tick);
      else requestAnimationFrame(tick);
    };

    v.onended = finish;
    recorder.start(250);
    await v.play();
    if (hasRvfc) v.requestVideoFrameCallback(tick);
    else requestAnimationFrame(tick);
    // Safety net: stop a little after the expected end even if frame callbacks stall.
    const guard = setTimeout(finish, (endS + 5) * 1000);

    await stopped;
    clearTimeout(guard);
    opts.signal?.removeEventListener("abort", onAbort);
    if (opts.signal?.aborted) throw new RenderError("canceled", "Canceled");
    const blob = new Blob(chunks, { type: type.split(";")[0] });
    if (!blob.size) throw new RenderError("render_failed", "The recording came out empty.");
    opts.onProgress?.(100);
    return { blob, durationMs: Math.round(endS * 1000), width, height };
  } catch (e) {
    if (e instanceof RenderError) throw e;
    throw new RenderError("render_failed", e instanceof Error ? e.message : "Render failed");
  } finally {
    if (video) disposeVideo(video);
    URL.revokeObjectURL(url);
  }
}
