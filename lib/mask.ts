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
    r.source === "auto" ? `Auto · ${placeName(r)}` : r.kind === "erase" ? "Erase box" : "Keep area";
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
