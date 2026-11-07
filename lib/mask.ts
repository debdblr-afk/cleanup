import type { Mask, Region } from "./types";

export const MIN_REGION = 0.01; // 1% of the frame; smaller boxes are almost always a mis-click

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Keep a region inside the frame and at least MIN_REGION wide and tall. */
export function normalizeRegion(r: Region): Region {
  const w = Math.min(1, Math.max(MIN_REGION, Math.abs(r.w)));
  const h = Math.min(1, Math.max(MIN_REGION, Math.abs(r.h)));
  const x = Math.min(1 - w, clamp01(r.w < 0 ? r.x + r.w : r.x));
  const y = Math.min(1 - h, clamp01(r.h < 0 ? r.y + r.h : r.y));
  return { ...r, x, y, w, h };
}

/**
 * A brush stroke as a region. `ratio` is the frame's width / height: the brush is round on
 * screen, so its radius in frame-height units is larger on a wide frame.
 */
export function brushRegion(o: { id: string; kind: Region["kind"]; points: { x: number; y: number }[]; size: number; ratio: number; tStartMs?: number; tEndMs?: number | null }): Region {
  const rx = o.size / 2, ry = (o.size / 2) * o.ratio;
  const xs = o.points.map((p) => p.x), ys = o.points.map((p) => p.y);
  const x = clamp01(Math.min(...xs) - rx), y = clamp01(Math.min(...ys) - ry);
  const x1 = clamp01(Math.max(...xs) + rx), y1 = clamp01(Math.max(...ys) + ry);
  return {
    id: o.id, kind: o.kind, shape: "brush", points: o.points.map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) })), size: o.size,
    x, y, w: Math.max(MIN_REGION, x1 - x), h: Math.max(MIN_REGION, y1 - y),
    tStartMs: o.tStartMs ?? 0, tEndMs: o.tEndMs ?? null, track: false, source: "user",
  };
}

/** Move a region's top-left to (x, y), kept inside the frame. A brush stroke moves with its box. */
export function moveRegion(r: Region, x: number, y: number): Region {
  const n = normalizeRegion({ ...r, x, y });
  if (r.shape !== "brush" || !r.points) return n;
  const dx = n.x - r.x, dy = n.y - r.y;
  return { ...n, points: r.points.map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) })) };
}

/**
 * The pixels a brush stroke covers on a W×H frame, as 0/1 bits over its pixel bounding box.
 * Circles are stamped along each segment, closer together than the radius, so the line is solid.
 */
export function rasterizeBrush(r: Region, width: number, height: number) {
  const { x0, y0, x1, y1 } = toPixels(r, width, height);
  const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0);
  const bits = new Uint8Array(w * h);
  const pts = r.points ?? [];
  const rad = Math.max(1, ((r.size ?? 0.02) * width) / 2);
  const stamp = (cx: number, cy: number) => {
    const ax = Math.max(x0, Math.floor(cx - rad)), bx = Math.min(x1 - 1, Math.ceil(cx + rad));
    const ay = Math.max(y0, Math.floor(cy - rad)), by = Math.min(y1 - 1, Math.ceil(cy + rad));
    for (let py = ay; py <= by; py++) for (let px = ax; px <= bx; px++) {
      const ddx = px + 0.5 - cx, ddy = py + 0.5 - cy;
      if (ddx * ddx + ddy * ddy <= rad * rad) bits[(py - y0) * w + (px - x0)] = 1;
    }
  };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
    const ax = a.x * width, ay = a.y * height, bx = b.x * width, by = b.y * height;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / Math.max(1, rad / 2)));
    for (let s = 0; s <= steps; s++) stamp(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps);
  }
  return { bits, x0, y0, x1, y1 };
}

/** Is the region active at time t (ms)? */
export function activeAt(r: Region, tMs: number): boolean {
  return tMs >= r.tStartMs && (r.tEndMs == null || tMs <= r.tEndMs);
}

/**
 * The mask the renderer uses: the user's own regions plus whatever detection found,
 * except detected regions the user deleted (they never come back on re-process).
 */
export function mergeMasks(user: Mask, detected: Mask | null): Mask {
  if (!detected) return user;
  const ids = new Set(user.regions.map((r) => r.id));
  return { regions: [...user.regions, ...detected.regions.filter((r) => !ids.has(r.id))] };
}

export function hasErase(mask: Mask): boolean {
  return mask.regions.some((r) => r.kind === "erase");
}

/** Pixel rectangle for a region on a w×h frame. Inclusive x0/y0, exclusive x1/y1. */
export function toPixels(r: Region, width: number, height: number) {
  const x0 = Math.max(0, Math.floor(r.x * width));
  const y0 = Math.max(0, Math.floor(r.y * height));
  const x1 = Math.min(width, Math.ceil((r.x + r.w) * width));
  const y1 = Math.min(height, Math.ceil((r.y + r.h) * height));
  return { x0, y0, x1, y1 };
}

export function describeRegion(r: Region): string {
  const where =
    r.source === "auto" ? `Auto · ${placeName(r)}`
      : r.shape === "brush" ? (r.kind === "erase" ? "Erase brush" : "Keep brush")
      : r.kind === "erase" ? "Erase box" : "Keep area";
  return where;
}

function placeName(r: Region): string {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const v = cy < 0.34 ? "top" : cy > 0.66 ? "bottom" : "middle";
  const h = cx < 0.34 ? "left" : cx > 0.66 ? "right" : "centre";
  return v === "middle" && h === "centre" ? "centre" : `${v} ${h}`;
}

/** Light validation of mask JSON coming back from storage (the server uses zod for the same rules). */
export function isMask(value: unknown): value is Mask {
  if (!value || typeof value !== "object") return false;
  const regions = (value as Mask).regions;
  return (
    Array.isArray(regions) &&
    regions.every(
      (r) =>
        r &&
        (r.kind === "erase" || r.kind === "protect") &&
        [r.x, r.y, r.w, r.h].every((n) => typeof n === "number" && n >= 0 && n <= 1),
    )
  );
}
