import { describe, expect, it } from "vitest";
import { brushRegion, moveRegion, rasterizeBrush } from "./mask";
import { fillMask } from "./engine/inpaint";
import type { Region } from "./types";

const stroke = (points: { x: number; y: number }[], size = 0.04): Region =>
  brushRegion({ id: "b1", kind: "erase", points, size, ratio: 16 / 9 });

describe("brush regions", () => {
  it("bounds a stroke by its points plus the brush radius (taller in y on a wide frame)", () => {
    const r = stroke([{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }]);
    expect(r.shape).toBe("brush");
    expect(r.x).toBeCloseTo(0.48);
    expect(r.w).toBeCloseTo(0.14);
    expect(r.y).toBeCloseTo(0.5 - 0.02 * (16 / 9));
    expect(r.h).toBeCloseTo(0.04 * (16 / 9));
  });

  it("keeps the bounds inside the frame for strokes at the edge", () => {
    const r = stroke([{ x: 0, y: 0 }, { x: 0.05, y: 0.02 }]);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it("moves points with the box, and stops at the frame edge", () => {
    const r = stroke([{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }]);
    const m = moveRegion(r, r.x + 0.1, r.y);
    expect(m.points![0].x).toBeCloseTo(0.6);
    expect(m.points![1].x).toBeCloseTo(0.7);
    const edge = moveRegion(r, 5, r.y);
    expect(edge.x + edge.w).toBeCloseTo(1);
    expect(edge.points![1].x).toBeCloseTo(1 - 0.02);
  });

  it("rasterizes a line, not its bounding box", () => {
    const r = stroke([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }], 0.02);
    const { bits, x0, y0, x1, y1 } = rasterizeBrush(r, 200, 100);
    const w = x1 - x0, h = y1 - y0;
    const on = bits.reduce((n, b) => n + b, 0);
    expect(on).toBeGreaterThan(0);
    expect(on).toBeLessThan(w * h * 0.3); // a diagonal stroke covers a small part of its box
    // A point on the line is set; the box's far corner is not.
    const at = (px: number, py: number) => bits[(py - y0) * w + (px - x0)];
    expect(at(100, 50)).toBe(1);
    expect(at(x1 - 1, y0)).toBe(0);
  });
});

describe("fillMask", () => {
  it("fills masked pixels from the colour around them and leaves the rest alone", () => {
    const W = 40, H = 20;
    const d = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { d[i * 4] = 100; d[i * 4 + 1] = 150; d[i * 4 + 2] = 200; d[i * 4 + 3] = 255; }
    const bits = new Uint8Array(W * H);
    for (let y = 8; y < 12; y++) for (let x = 5; x < 35; x++) { bits[y * W + x] = 1; d[(y * W + x) * 4] = 255; d[(y * W + x) * 4 + 1] = 255; d[(y * W + x) * 4 + 2] = 255; }
    d[0] = 7; // an unmasked pixel that must not change
    fillMask(d, W, H, bits);
    const p = (10 * W + 20) * 4;
    expect(Math.abs(d[p] - 100)).toBeLessThan(3);
    expect(Math.abs(d[p + 1] - 150)).toBeLessThan(3);
    expect(Math.abs(d[p + 2] - 200)).toBeLessThan(3);
    expect(d[0]).toBe(7);
  });

  it("blends a gradient smoothly across the mask", () => {
    const W = 30, H = 10;
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = (y * W + x) * 4; d[p] = x * 8; d[p + 3] = 255; }
    const bits = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 10; x < 20; x++) bits[y * W + x] = 1;
    fillMask(d, W, H, bits);
    const row = Array.from({ length: 12 }, (_, i) => d[(5 * W + 9 + i) * 4]);
    for (let i = 1; i < row.length; i++) expect(row[i]).toBeGreaterThanOrEqual(row[i - 1] - 1);
    expect(Math.abs(d[(5 * W + 15) * 4] - 120)).toBeLessThan(12);
  });

  it("does nothing with an empty mask, or a mask that covers everything", () => {
    const d = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
    fillMask(d, 2, 1, new Uint8Array(2));
    fillMask(d, 2, 1, new Uint8Array([1, 1]));
    expect(Array.from(d)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  });
});
