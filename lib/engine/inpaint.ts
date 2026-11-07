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

/**
 * Fill any shape (a brush stroke): `bits` marks the pixels to replace. Each one starts as an
 * inverse-distance blend of the nearest unmasked pixel left, right, above and below it, then
 * a few rounds of neighbour averaging smooth the seams. Pure, like fillRect.
 */
export function fillMask(data: Uint8ClampedArray, width: number, height: number, bits: Uint8Array, rounds = 24): void {
  const n = width * height;
  let count = 0;
  for (let i = 0; i < n; i++) count += bits[i];
  if (!count || count === n) return;
  const idx = new Int32Array(count);
  for (let i = 0, k = 0; i < n; i++) if (bits[i]) idx[k++] = i;

  // Start: nearest unmasked pixel in each of the four directions.
  const start = new Float32Array(count * 3);
  for (let k = 0; k < count; k++) {
    const i = idx[k], x = i % width, y = (i / width) | 0;
    let r = 0, g = 0, b = 0, wsum = 0;
    const look = (dx: number, dy: number) => {
      for (let d = 1, sx = x + dx, sy = y + dy; sx >= 0 && sy >= 0 && sx < width && sy < height; d++, sx += dx, sy += dy) {
        const j = sy * width + sx;
        if (bits[j]) continue;
        const w = 1 / (d * d), p = j * 4;
        r += data[p] * w; g += data[p + 1] * w; b += data[p + 2] * w; wsum += w;
        return;
      }
    };
    look(-1, 0); look(1, 0); look(0, -1); look(0, 1);
    if (wsum) { start[k * 3] = r / wsum; start[k * 3 + 1] = g / wsum; start[k * 3 + 2] = b / wsum; }
  }
  for (let k = 0; k < count; k++) {
    const p = idx[k] * 4;
    data[p] = start[k * 3]; data[p + 1] = start[k * 3 + 1]; data[p + 2] = start[k * 3 + 2];
  }

  // Smooth: each masked pixel becomes the average of its four neighbours.
  const next = new Float32Array(count * 3);
  for (let round = 0; round < rounds; round++) {
    for (let k = 0; k < count; k++) {
      const i = idx[k], x = i % width, y = (i / width) | 0;
      let r = 0, g = 0, b = 0, m = 0;
      const add = (j: number) => { const p = j * 4; r += data[p]; g += data[p + 1]; b += data[p + 2]; m++; };
      if (x > 0) add(i - 1);
      if (x < width - 1) add(i + 1);
      if (y > 0) add(i - width);
      if (y < height - 1) add(i + width);
      next[k * 3] = r / m; next[k * 3 + 1] = g / m; next[k * 3 + 2] = b / m;
    }
    for (let k = 0; k < count; k++) {
      const p = idx[k] * 4;
      data[p] = next[k * 3]; data[p + 1] = next[k * 3 + 1]; data[p + 2] = next[k * 3 + 2];
    }
  }
}
