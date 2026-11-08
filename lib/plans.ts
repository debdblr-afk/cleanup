import type { Export, PlanId } from "./types";

// Plan limits live in code (architecture.md, "Plan limits"). The export caps match the
// original's public pricing (10 a day on the middle plan, 50 on the top one); the rest are
// starting guesses to tune once real GPU cost per minute is known.

export type Plan = {
  id: PlanId;
  name: string;
  pitch: string;
  previewsPerDay: number;
  exportsPerDay: number; // Infinity = unlimited
  maxDurationMs: number;
  maxBytes: number;
  maxResolution: Export["resolution"] | null;
  retentionDays: number;
  monthly: number | null; // placeholder prices in USD, set for real in /replica-launch
  yearlyPerMonth: number | null;
};

const MB = 1024 * 1024;
const MIN = 60_000;
// Hosting can cap uploads below the plan (Supabase's free plan stores files up to 50 MB):
// set NEXT_PUBLIC_MAX_UPLOAD_MB and every plan shows and enforces the lower limit.
const HOST_CAP = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB || 0) * MB || Infinity;
const capped = (bytes: number) => Math.min(bytes, HOST_CAP);

export const PLANS: Record<PlanId, Plan> = {
  guest: { id: "guest", name: "Guest", pitch: "No account needed", previewsPerDay: 3, exportsPerDay: 0, maxDurationMs: 1 * MIN, maxBytes: capped(500 * MB), maxResolution: null, retentionDays: 1, monthly: null, yearlyPerMonth: null },
  free: { id: "free", name: "Free", pitch: "Try it on short clips", previewsPerDay: 5, exportsPerDay: 0, maxDurationMs: 2 * MIN, maxBytes: capped(1024 * MB), maxResolution: null, retentionDays: 3, monthly: 0, yearlyPerMonth: 0 },
  plus: { id: "plus", name: "Plus", pitch: "For weekly posting", previewsPerDay: 30, exportsPerDay: 10, maxDurationMs: 10 * MIN, maxBytes: capped(2048 * MB), maxResolution: "1080p", retentionDays: 14, monthly: 12, yearlyPerMonth: 9 },
  pro: { id: "pro", name: "Pro", pitch: "For teams and agencies", previewsPerDay: 100, exportsPerDay: Infinity, maxDurationMs: 30 * MIN, maxBytes: capped(4096 * MB), maxResolution: "2160p", retentionDays: 7, monthly: 32, yearlyPerMonth: 24 },
};

/** Everyone gets this plan's limits: there are no paid tiers (owner's decision, 2026-11-07). */
export const DEFAULT_PLAN: PlanId = "pro";

export const RESOLUTIONS: { id: Export["resolution"]; label: string; height: number }[] = [
  { id: "720p", label: "720p", height: 720 },
  { id: "1080p", label: "1080p", height: 1080 },
  { id: "1440p", label: "2K", height: 1440 },
  { id: "2160p", label: "4K", height: 2160 },
];

export function resolutionAllowed(plan: Plan, res: Export["resolution"]): boolean {
  if (!plan.maxResolution) return false;
  const order = RESOLUTIONS.map((r) => r.id);
  return order.indexOf(res) <= order.indexOf(plan.maxResolution);
}

export const PREVIEW_MS = 5_000;
export const BATCH_LIMIT = 30;
export const ATTESTATION_VERSION = "2026-11-07";
export const ACCEPTED_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];
