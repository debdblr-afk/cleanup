import { describe, expect, it } from "vitest";
import { consume, emptyQuota, forDate, refund, remaining } from "./data/quota";
import { formatClock, formatDuration, hoursUntilUtcMidnight, ordinal, utcDate } from "./format";
import { activeAt, isMask, mergeMasks, normalizeRegion, toPixels } from "./mask";
import { PLANS, resolutionAllowed } from "./plans";
import type { Region } from "./types";

const region = (p: Partial<Region> = {}): Region => ({
  id: "r1", kind: "erase", shape: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.1, tStartMs: 0, tEndMs: null, track: false, source: "user", ...p,
});

describe("quota", () => {
  it("counts up to the cap and stops", () => {
    let q = emptyQuota("2026-11-07");
    q = consume(q, "export", 2)!;
    q = consume(q, "export", 2)!;
    expect(consume(q, "export", 2)).toBeNull();
    expect(remaining(q, "export", 2)).toBe(0);
  });
  it("a cap of zero never allows", () => {
    expect(consume(emptyQuota("d"), "export", 0)).toBeNull();
  });
  it("rolls over on a new UTC day", () => {
    const q = { date: "2026-11-06", preview: 3, export: 1 };
    expect(forDate(q, "2026-11-07")).toEqual(emptyQuota("2026-11-07"));
    expect(forDate(q, "2026-11-06")).toBe(q);
  });
  it("refunds only on the same day and never below zero", () => {
    const q = { date: "2026-11-07", preview: 1, export: 0 };
    expect(refund(q, "preview", "2026-11-07").preview).toBe(0);
    expect(refund(q, "export", "2026-11-07").export).toBe(0);
    expect(refund(q, "preview", "2026-11-06").preview).toBe(1);
  });
});

describe("mask", () => {
  it("normalizes a box dragged up and left", () => {
    const r = normalizeRegion(region({ x: 0.5, y: 0.5, w: -0.2, h: -0.1 }));
    expect(r.x).toBeCloseTo(0.3);
    expect(r.y).toBeCloseTo(0.4);
    expect(r.w).toBeCloseTo(0.2);
    expect(r.h).toBeCloseTo(0.1);
  });
  it("keeps boxes inside the frame and at least 1%", () => {
    const r = normalizeRegion(region({ x: 0.95, y: 0.99, w: 0.2, h: 0.0001 }));
    expect(r.x + r.w).toBeLessThanOrEqual(1);
    expect(r.y + r.h).toBeLessThanOrEqual(1);
    expect(r.h).toBeGreaterThanOrEqual(0.01);
  });
  it("checks time ranges", () => {
    expect(activeAt(region({ tStartMs: 1000, tEndMs: 2000 }), 1500)).toBe(true);
    expect(activeAt(region({ tStartMs: 1000, tEndMs: 2000 }), 2500)).toBe(false);
    expect(activeAt(region({ tStartMs: 1000 }), 99_000)).toBe(true);
  });
  it("merges detected regions but not ones the user already has", () => {
    const auto = region({ id: "a", source: "auto" });
    const merged = mergeMasks({ regions: [region({ id: "a" }), region({ id: "u" })] }, { regions: [auto, region({ id: "b", source: "auto" })] });
    expect(merged.regions.map((r) => r.id)).toEqual(["a", "u", "b"]);
  });
  it("converts to pixels inside the frame", () => {
    expect(toPixels(region({ x: 0.9, y: 0.9, w: 0.2, h: 0.2 }), 100, 50)).toEqual({ x0: 90, y0: 45, x1: 100, y1: 50 });
  });
  it("validates stored masks", () => {
    expect(isMask({ regions: [region()] })).toBe(true);
    expect(isMask({ regions: [{ ...region(), x: 2 }] })).toBe(false);
    expect(isMask(null)).toBe(false);
  });
});

describe("plans", () => {
  it("gates resolutions by plan", () => {
    expect(resolutionAllowed(PLANS.guest, "720p")).toBe(false);
    expect(resolutionAllowed(PLANS.plus, "1080p")).toBe(true);
    expect(resolutionAllowed(PLANS.plus, "1440p")).toBe(false);
    expect(resolutionAllowed(PLANS.pro, "2160p")).toBe(true);
  });
});

describe("format", () => {
  it("formats durations and clocks", () => {
    expect(formatDuration(42_000)).toBe("0:42");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
    expect(formatDuration(null)).toBe("–:––");
    expect(formatClock(3.2)).toBe("0:03.20");
  });
  it("uses UTC days", () => {
    const late = new Date("2026-11-07T23:30:00Z");
    expect(utcDate(late)).toBe("2026-11-07");
    expect(hoursUntilUtcMidnight(late)).toBe(1);
  });
  it("ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });
});
