import { describe, expect, it } from "vitest";
import { detectStatic } from "./detect";
import { fillRect } from "./inpaint";

function solid(width: number, height: number, rgb: [number, number, number]) {
  const d = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) d.set([...rgb, 255], p * 4);
  return d;
}

describe("fillRect", () => {
  it("replaces a logo on a flat background with the background colour", () => {
    const W = 40, H = 30;
    const d = solid(W, H, [40, 90, 160]);
    for (let y = 10; y < 20; y++) for (let x = 10; x < 30; x++) d.set([255, 255, 255, 255], (y * W + x) * 4);
    fillRect(d, W, H, { x0: 10, y0: 10, x1: 30, y1: 20 });
    for (let y = 10; y < 20; y++)
      for (let x = 10; x < 30; x++) {
        const p = (y * W + x) * 4;
        expect([d[p], d[p + 1], d[p + 2]]).toEqual([40, 90, 160]);
      }
  });

  it("blends a horizontal gradient smoothly across the box", () => {
    const W = 50, H = 10;
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d.set([x * 5, 0, 0, 255], (y * W + x) * 4);
    fillRect(d, W, H, { x0: 20, y0: 0, x1: 30, y1: H });
    const row = Array.from({ length: 10 }, (_, i) => d[(5 * W + 20 + i) * 4]);
    for (let i = 1; i < row.length; i++) expect(row[i]).toBeGreaterThanOrEqual(row[i - 1]);
    expect(row[0]).toBeGreaterThan(85);
    expect(row[9]).toBeLessThan(160);
  });

  it("leaves protected pixels alone", () => {
    const W = 20, H = 20;
    const d = solid(W, H, [0, 0, 0]);
    d.set([200, 10, 10, 255], (10 * W + 10) * 4);
    fillRect(d, W, H, { x0: 5, y0: 5, x1: 15, y1: 15 }, (x, y) => x === 10 && y === 10);
    expect(d[(10 * W + 10) * 4]).toBe(200);
    expect(d[(6 * W + 6) * 4]).toBe(0);
  });

  it("handles a box touching the frame edge", () => {
    const W = 20, H = 20;
    const d = solid(W, H, [10, 20, 30]);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) d.set([255, 255, 255, 255], (y * W + x) * 4);
    fillRect(d, W, H, { x0: 0, y0: 0, x1: 5, y1: 5 });
    expect([d[0], d[1], d[2]]).toEqual([10, 20, 30]);
  });

  it("ignores an empty or whole-frame box", () => {
    const d = solid(4, 4, [1, 2, 3]);
    fillRect(d, 4, 4, { x0: 2, y0: 2, x1: 2, y1: 3 });
    fillRect(d, 4, 4, { x0: 0, y0: 0, x1: 4, y1: 4 });
    expect([d[0], d[1], d[2]]).toEqual([1, 2, 3]);
  });
});

describe("detectStatic", () => {
  // Moving noise everywhere, plus a fixed bright "logo" with letter-like strokes bottom right.
  function frames(n: number, W: number, H: number, withLogo: boolean) {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    return Array.from({ length: n }, (_, k) => {
      const f = new Float32Array(W * H);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) f[y * W + x] = 60 + 60 * Math.sin((x + k * 9) * 0.3) * Math.cos((y + k * 5) * 0.25) + rand() * 30;
      if (withLogo)
        for (let y = 70; y < 80; y++)
          for (let x = 110; x < 150; x++) if ((x - 110) % 6 < 3) f[y * W + x] = 250;
      return f;
    });
  }

  it("finds a static mark over moving footage", () => {
    const W = 160, H = 90;
    const boxes = detectStatic(frames(12, W, H, true), W, H);
    expect(boxes.length).toBeGreaterThan(0);
    const b = boxes[0];
    // The logo spans x 110..150, y 70..80 on a 160x90 grid.
    expect(b.x).toBeLessThan(112 / W);
    expect(b.x + b.w).toBeGreaterThan(148 / W);
    expect(b.y).toBeLessThan(72 / H);
    expect(b.y + b.h).toBeGreaterThan(78 / H);
    expect(b.w * b.h).toBeLessThan(0.12);
  });

  it("finds nothing when there is no mark", () => {
    const W = 160, H = 90;
    expect(detectStatic(frames(12, W, H, false), W, H)).toEqual([]);
  });

  it("needs at least three frames", () => {
    expect(detectStatic(frames(2, 160, 90, true), 160, 90)).toEqual([]);
  });
});
