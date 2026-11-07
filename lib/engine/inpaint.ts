// Baseline fill for an erase box: every pixel inside is a blend of the pixels just
// outside the box's four sides, weighted by inverse squared distance. Good enough for a
// static logo on a smooth background; busy or moving backgrounds need the real
// temporal model on the GPU worker (architecture.md, "Model licences").
// Pure: works on an RGBA byte array so it runs in tests without a browser.

export type Rect = { x0: number; y0: number; x1: number; y1: number };

const BAND = 3; // average this many pixels outside each side, so one noisy pixel doesn't streak

function sample(
  data: Uint8ClampedArray, width: number, height: number,
  x: number, y: number, dx: number, dy: number, out: Float32Array,
): boolean {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < BAND; i++) {
    const sx = x + dx * i;
    const sy = y + dy * i;
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) break;
    const p = (sy * width + sx) * 4;
    r += data[p]; g += data[p + 1]; b += data[p + 2]; n++;
  }
  if (!n) return false;
  out[0] = r / n; out[1] = g / n; out[2] = b / n;
  return true;
}

export function fillRect(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  rect: Rect,
  isProtected?: (x: number, y: number) => boolean,
): void {
  const x0 = Math.max(0, rect.x0), y0 = Math.max(0, rect.y0);
  const x1 = Math.min(width, rect.x1), y1 = Math.min(height, rect.y1);
  const rw = x1 - x0, rh = y1 - y0;
  if (rw <= 0 || rh <= 0) return;

  // Edge colours: one per row for left/right, one per column for top/bottom. NaN = side missing.
  const left = new Float32Array(rh * 3).fill(NaN);
  const right = new Float32Array(rh * 3).fill(NaN);
  const top = new Float32Array(rw * 3).fill(NaN);
  const bottom = new Float32Array(rw * 3).fill(NaN);
  const tmp = new Float32Array(3);

  for (let j = 0; j < rh; j++) {
    if (sample(data, width, height, x0 - 1, y0 + j, -1, 0, tmp)) left.set(tmp, j * 3);
    if (sample(data, width, height, x1, y0 + j, 1, 0, tmp)) right.set(tmp, j * 3);
  }
  for (let i = 0; i < rw; i++) {
    if (sample(data, width, height, x0 + i, y0 - 1, 0, -1, tmp)) top.set(tmp, i * 3);
    if (sample(data, width, height, x0 + i, y1, 0, 1, tmp)) bottom.set(tmp, i * 3);
  }
  if (Number.isNaN(left[0]) && Number.isNaN(right[0]) && Number.isNaN(top[0]) && Number.isNaN(bottom[0])) return;

  for (let j = 0; j < rh; j++) {
    const y = y0 + j;
    for (let i = 0; i < rw; i++) {
      const x = x0 + i;
      if (isProtected?.(x, y)) continue;
      let r = 0, g = 0, b = 0, wsum = 0;
      const add = (arr: Float32Array, idx: number, d: number) => {
        const c = arr[idx];
        if (Number.isNaN(c)) return;
        const w = 1 / (d * d);
        r += c * w; g += arr[idx + 1] * w; b += arr[idx + 2] * w; wsum += w;
      };
      add(left, j * 3, i + 1);
      add(right, j * 3, rw - i);
      add(top, i * 3, j + 1);
      add(bottom, i * 3, rh - j);
      if (!wsum) continue;
      const p = (y * width + x) * 4;
      data[p] = r / wsum;
      data[p + 1] = g / wsum;
      data[p + 2] = b / wsum;
    }
  }
}
