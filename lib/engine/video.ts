// Browser helpers around <video>: load, seek, probe, sample frames.

export async function loadVideo(url: string): Promise<HTMLVideoElement> {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.crossOrigin = "anonymous";
  // Some browsers pause decoding of detached videos; keep it in the DOM but invisible.
  Object.assign(v.style, { position: "fixed", left: "-9999px", top: "0", width: "2px", height: "2px", opacity: "0", pointerEvents: "none" });
  document.body.appendChild(v);
  v.src = url;
  await new Promise<void>((resolve, reject) => {
    v.onloadedmetadata = () => resolve();
    v.onerror = () => reject(new Error("unsupported"));
    // Some browsers never fire either event for a file they can't read: don't wait forever.
    setTimeout(() => reject(new Error("unsupported")), 30_000);
  });
  await fixDuration(v);
  return v;
}

export function disposeVideo(v: HTMLVideoElement) {
  v.pause();
  v.removeAttribute("src");
  v.load();
  v.remove();
}

/** MediaRecorder WebM files report Infinity until you seek past the end once. */
async function fixDuration(v: HTMLVideoElement) {
  if (Number.isFinite(v.duration)) return;
  await new Promise<void>((resolve) => {
    const done = () => { v.removeEventListener("durationchange", check); resolve(); };
    const check = () => { if (Number.isFinite(v.duration)) done(); };
    v.addEventListener("durationchange", check);
    v.currentTime = 1e7;
    setTimeout(done, 3000);
  });
  v.currentTime = 0;
  await new Promise((r) => setTimeout(r, 50));
}

export function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - t) < 0.001 && v.readyState >= 2) return resolve();
    const done = () => { v.removeEventListener("seeked", done); resolve(); };
    v.addEventListener("seeked", done);
    v.currentTime = t;
    setTimeout(done, 4000);
  });
}

export type Probe = { durationMs: number; width: number; height: number; thumbnail: string | null };

export async function probe(blob: Blob): Promise<Probe> {
  const url = URL.createObjectURL(blob);
  try {
    const v = await loadVideo(url);
    const durationMs = Math.round(v.duration * 1000);
    if (!v.videoWidth || !Number.isFinite(durationMs) || durationMs <= 0) throw new Error("corrupt");
    await seek(v, Math.min(0.5, v.duration / 2));
    const tw = 320;
    const th = Math.round((tw * v.videoHeight) / v.videoWidth);
    const c = document.createElement("canvas");
    c.width = tw; c.height = th;
    c.getContext("2d")!.drawImage(v, 0, 0, tw, th);
    const thumbnail = c.toDataURL("image/jpeg", 0.72);
    const out = { durationMs, width: v.videoWidth, height: v.videoHeight, thumbnail };
    disposeVideo(v);
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Luminance frames at low resolution, evenly spaced, for detectStatic(). */
export async function sampleFrames(blob: Blob, count = 12, width = 160) {
  const url = URL.createObjectURL(blob);
  const v = await loadVideo(url);
  try {
    const W = width;
    const H = Math.max(1, Math.round((W * v.videoHeight) / v.videoWidth));
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    const frames: Float32Array[] = [];
    const span = v.duration * 0.94;
    for (let i = 0; i < count; i++) {
      await seek(v, v.duration * 0.03 + (span * i) / Math.max(1, count - 1));
      ctx.drawImage(v, 0, 0, W, H);
      const d = ctx.getImageData(0, 0, W, H).data;
      const f = new Float32Array(W * H);
      for (let p = 0; p < W * H; p++) f[p] = 0.299 * d[p * 4] + 0.587 * d[p * 4 + 1] + 0.114 * d[p * 4 + 2];
      frames.push(f);
    }
    return { frames, W, H };
  } finally {
    disposeVideo(v);
    URL.revokeObjectURL(url);
  }
}

export function pickRecorderType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export function extensionFor(type: string): string {
  return type.startsWith("video/mp4") ? "mp4" : "webm";
}
