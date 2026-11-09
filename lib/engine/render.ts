// Renders a cleaned copy of a video in the browser: plays it (muted) into a canvas, fills
// every active erase region each frame, and records the canvas. Stand-in for the GPU
// worker's render(preview | full); same inputs (video, mask, limits) and output (a file).
// The original sound is carried over: the video's audio is routed (not to the speakers) into
// the recording, in sync because the video plays in real time.

import fixWebmDuration from "fix-webm-duration";
import { activeAt, rasterizeBrush, toPixels } from "../mask";
import type { Mask } from "../types";
import { runningAudioContext } from "./audio";
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

/** WebM with Opus sound when the browser can record it, else whatever video type it has. */
function typeWithAudio(videoType: string): string {
  const withSound = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm;codecs=opus", "video/mp4;codecs=avc1,mp4a"];
  return withSound.find((t) => MediaRecorder.isTypeSupported(t)) ?? videoType;
}

/**
 * The video's sound as a track for the recorder, through the shared AudioContext. Sound goes to
 * the recording only, never the speakers. Null (record without sound) when the browser won't run
 * audio right now; this never waits more than a moment (see audio.ts, BUG-013).
 */
async function audioTrackFor(v: HTMLVideoElement): Promise<{ track: MediaStreamTrack; close: () => void } | null> {
  const ctx = await runningAudioContext();
  if (!ctx) return null;
  try {
    const dest = ctx.createMediaStreamDestination();
    const src = ctx.createMediaElementSource(v);
    src.connect(dest);
    v.muted = false;
    v.volume = 1;
    const track = dest.stream.getAudioTracks()[0];
    const close = () => { try { src.disconnect(); dest.disconnect(); } catch { /* already gone */ } };
    if (!track) { close(); return null; }
    return { track, close };
  } catch {
    return null;
  }
}

export async function render(source: Blob, mask: Mask, opts: RenderOptions): Promise<RenderResult> {
  const type = pickRecorderType();
  if (!type || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
    throw new RenderError("unsupported_browser", "This browser can't record video. Try Chrome, Edge or Firefox.");
  }
  const url = URL.createObjectURL(source);
  let video: HTMLVideoElement | null = null;
  let audio: Awaited<ReturnType<typeof audioTrackFor>> = null;
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
    audio = await audioTrackFor(v);
    if (audio) stream.addTrack(audio.track);
    let recordType = audio ? typeWithAudio(type) : type;
    const bits = { videoBitsPerSecond: height >= 1080 ? 8_000_000 : 4_000_000, audioBitsPerSecond: 160_000 };
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: recordType, ...bits });
    } catch {
      // This browser can't record that combination: record the picture alone rather than fail.
      if (audio) { stream.removeTrack(audio.track); audio.close(); audio = null; }
      recordType = type;
      recorder = new MediaRecorder(stream, { mimeType: recordType, ...bits });
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    // Ends when the recorder stops, or errors. Some browsers stop a recorder on their own after an
    // error and never fire "stop" again, so finish() also ends it when the recorder is already inactive.
    let endRecording!: () => void;
    let recordError: unknown = null;
    const stopped = new Promise<void>((resolve) => { endRecording = resolve; recorder.onstop = () => resolve(); });
    recorder.onerror = (e) => { recordError = (e as unknown as { error?: unknown }).error ?? e; finish(); };

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      v.pause();
      if (recorder.state !== "inactive") recorder.stop();
      else endRecording();
      // Belt and braces: never wait more than 3 s for "stop" once finished.
      setTimeout(endRecording, 3000);
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
    if (recordError && !chunks.length) throw new RenderError("render_failed", "The browser stopped recording.");
    let blob = new Blob(chunks, { type: recordType.split(";")[0] });
    if (!blob.size) throw new RenderError("render_failed", "The recording came out empty.");
    // MediaRecorder leaves the length out of WebM files; write it in so players can show it and seek.
    if (blob.type === "video/webm") blob = await fixWebmDuration(blob, endS * 1000, { logger: false }).catch(() => blob);
    opts.onProgress?.(100);
    return { blob, durationMs: Math.round(endS * 1000), width, height };
  } catch (e) {
    if (e instanceof RenderError) throw e;
    throw new RenderError("render_failed", e instanceof Error ? e.message : "Render failed");
  } finally {
    audio?.close();
    if (video) disposeVideo(video);
    URL.revokeObjectURL(url);
  }
}
