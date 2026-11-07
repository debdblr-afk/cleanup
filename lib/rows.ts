// Database rows (snake_case, from RLS reads, Realtime and API responses) -> app types.
import { isMask } from "./mask";
import type { Batch, Export, Job, Mask, PlanId, Profile, Video } from "./types";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? null : String(v));
const n = (v: unknown) => (v == null ? null : Number(v));
const mask = (v: unknown): Mask => (isMask(v) ? v : { regions: [] });

export const fileUrl = (kind: "original" | "thumb" | "preview" | "result", id: string, download?: string) =>
  `/api/files?kind=${kind}&id=${id}${download ? `&download=${encodeURIComponent(download)}` : ""}`;

export function toBatch(r: Row): Batch {
  return { id: String(r.id), name: s(r.name), createdAt: String(r.created_at), expiresAt: String(r.expires_at) };
}

export function toVideo(r: Row): Video {
  return {
    id: String(r.id), batchId: String(r.batch_id), position: Number(r.position ?? 0),
    source: r.source as Video["source"], filename: String(r.filename), contentType: String(r.content_type),
    sizeBytes: Number(r.size_bytes), status: r.status as Video["status"], rejectReason: (r.reject_reason as Video["rejectReason"]) ?? null,
    durationMs: n(r.duration_ms), width: n(r.width), height: n(r.height),
    thumbnail: r.thumbnail_key ? fileUrl("thumb", String(r.id)) : null,
    rightsAttestedAt: String(r.rights_attested_at), attestationVersion: String(r.attestation_version), createdAt: String(r.created_at),
  };
}

export function toJob(r: Row): Job {
  return {
    id: String(r.id), videoId: String(r.video_id), parentJobId: s(r.parent_job_id), mode: r.mode as Job["mode"],
    autoDetect: Boolean(r.auto_detect), mask: mask(r.mask), detectedMask: r.detected_mask ? mask(r.detected_mask) : null,
    status: r.status as Job["status"], progress: Number(r.progress ?? 0), errorCode: (r.error_code as Job["errorCode"]) ?? null,
    errorMessage: s(r.error_message), previewMs: n(r.preview_ms), createdAt: String(r.created_at), finishedAt: s(r.finished_at),
    quotaDate: String(r.quota_date),
  };
}

export function toExport(r: Row): Export {
  return {
    id: String(r.id), jobId: String(r.job_id), resolution: r.resolution as Export["resolution"], status: r.status as Export["status"],
    progress: Number(r.progress ?? 0), sizeBytes: n(r.size_bytes), errorMessage: s(r.error_message), createdAt: String(r.created_at),
    finishedAt: s(r.finished_at),
  };
}

export function toProfile(r: Row): Profile {
  return {
    id: String(r.id), email: s(r.email), isAnonymous: Boolean(r.is_anonymous),
    plan: (r.plan as Profile["plan"]) ?? "free", hasBilling: Boolean(r.stripe_customer_id),
  };
}

/** Guests are anonymous accounts. A dev-only demo plan on a guest still counts (ALLOW_DEMO_PLAN). */
export function planIdFor(p: { isAnonymous: boolean; plan: Profile["plan"] } | null): PlanId {
  if (!p) return "guest";
  if (p.isAnonymous) return p.plan === "free" ? "guest" : p.plan;
  return p.plan;
}
