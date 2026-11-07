// Finds static overlays (logos, handles, burned-in marks) from a handful of frames
// sampled across the video. A watermark stays put while the picture behind it moves, so
// its pixels change little over time (low temporal spread) and its edges survive in the
// average of all frames (moving edges blur out). Classical and cheap; the GPU worker adds
// a text detector and tracking for moving marks (architecture.md, "detection").
// Pure: takes luminance arrays so it runs in tests.

export type Box = { x: number; y: number; w: number; h: number; score: number }; // 0..1 of frame

export type DetectOptions = {
  maxBoxes?: number;
  minArea?: number; // fraction of frame
  maxArea?: number;
};

export function detectStatic(frames: Float32Array[], W: number, H: number, opts: DetectOptions = {}): Box[] {
  const { maxBoxes = 3, minArea = 0.0005, maxArea = 0.12 } = opts;
  const n = frames.length;
  if (n < 3) return [];
  const N = W * H;

  const mean = new Float32Array(N);
  const spread = new Float32Array(N);
  for (const f of frames) for (let p = 0; p < N; p++) mean[p] += f[p] / n;
  for (const f of frames) for (let p = 0; p < N; p++) spread[p] += (f[p] - mean[p]) ** 2 / n;
  for (let p = 0; p < N; p++) spread[p] = Math.sqrt(spread[p]);

  // Edges of the mean image.
  const edge = new Float32Array(N);
  for (let y = 0; y < H - 1; y++)
    for (let x = 0; x < W - 1; x++) {
      const p = y * W + x;
      edge[p] = Math.abs(mean[p + 1] - mean[p]) + Math.abs(mean[p + W] - mean[p]);
    }

  const sorted = Float32Array.from(spread).sort();
  const medianSpread = sorted[Math.floor(N / 2)];
  const stillLimit = Math.max(3, medianSpread * 0.35);
  const staticShare = sorted.findIndex((v) => v >= stillLimit) / N;
  // Mostly still footage (tripod shot): everything is "static", so only trust the outer bands
  // where watermarks usually sit.
  const bandsOnly = staticShare < 0 || staticShare > 0.5;

  const hit = new Uint8Array(N);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (spread[p] >= stillLimit || edge[p] < 14) continue;
      if (bandsOnly) {
        const inCentre = x > W * 0.25 && x < W * 0.75 && y > H * 0.25 && y < H * 0.75;
        if (inCentre) continue;
      }
      hit[p] = 1;
    }

  // Dilate twice so the strokes of one word join into one blob.
  let grown = hit;
  for (let k = 0; k < 2; k++) {
    const next = new Uint8Array(N);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (grown[p] || (x > 0 && grown[p - 1]) || (x < W - 1 && grown[p + 1]) || (y > 0 && grown[p - W]) || (y < H - 1 && grown[p + W])) next[p] = 1;
      }
    grown = next;
  }

  // Connected components -> bounding boxes.
  const seen = new Uint8Array(N);
  const boxes: Box[] = [];
  const stack: number[] = [];
  for (let start = 0; start < N; start++) {
    if (!grown[start] || seen[start]) continue;
    let minX = W, minY = H, maxX = 0, maxY = 0, core = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W, y = (p - x) / W;
      if (hit[p]) core++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
      for (const q of nb) if (q >= 0 && grown[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const area = (bw * bh) / N;
    if (core < 6 || area < minArea || area > maxArea) continue;
    const pad = 1;
    const x0 = Math.max(0, minX - pad), y0 = Math.max(0, minY - pad);
    const x1 = Math.min(W, maxX + 1 + pad), y1 = Math.min(H, maxY + 1 + pad);
    boxes.push({ x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H, score: core });
  }
  return boxes.sort((a, b) => b.score - a.score).slice(0, maxBoxes);
}
