"use client";
// Fake data layer. Same operations as the API in architecture.md (one function per
// route), backed by IndexedDB in this browser, with an in-browser worker standing in for
// Inngest + the GPU. /replica-backend swaps the bodies for fetch() calls and Supabase
// Realtime; screens only use these functions and the hooks in ./hooks.ts.

import { detectStatic } from "../engine/detect";
import { render, RenderError } from "../engine/render";
import { probe, sampleFrames } from "../engine/video";
import { hoursUntilUtcMidnight, uid, utcDate } from "../format";
import { hasErase, mergeMasks } from "../mask";
import { ACCEPTED_TYPES, ATTESTATION_VERSION, BATCH_LIMIT, PLANS, PREVIEW_MS, RESOLUTIONS, resolutionAllowed, type Plan } from "../plans";
import type { Batch, Export, Job, Mask, PlanId, RejectReason, Region, RemovalMode, Video } from "../types";
import * as db from "./idb";
import { consume, forDate, refund, remaining, type QuotaKind, type QuotaState } from "./quota";

// ---------------------------------------------------------------------------
// State + change notification (the Realtime stand-in)
// ---------------------------------------------------------------------------

type State = {
  hydrated: boolean;
  batches: Map<string, Batch>;
  videos: Map<string, Video>;
  jobs: Map<string, Job>;
  exports: Map<string, Export>;
};

const state: State = { hydrated: false, batches: new Map(), videos: new Map(), jobs: new Map(), exports: new Map() };
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getVersion(): number {
  return version;
}

export function getState(): Readonly<State> {
  return state;
}

const key = {
  batch: (id: string) => `batch:${id}`,
  video: (id: string) => `video:${id}`,
  job: (id: string) => `job:${id}`,
  export: (id: string) => `export:${id}`,
  original: (videoId: string) => `original:${videoId}`,
  preview: (jobId: string) => `preview:${jobId}`,
  result: (exportId: string) => `result:${exportId}`,
};

async function save(kind: "batch" | "video" | "job" | "export", rec: Batch | Video | Job | Export) {
  const map = { batch: state.batches, video: state.videos, job: state.jobs, export: state.exports }[kind] as Map<string, typeof rec>;
  map.set(rec.id, rec);
  emit();
  await db.put(db.RECORDS, key[kind](rec.id), rec);
}

/** In-memory only; progress ticks don't need a disk write each time. */
function patchLive<T extends { id: string }>(map: Map<string, T>, id: string, patch: Partial<T>) {
  const cur = map.get(id);
  if (!cur) return;
  map.set(id, { ...cur, ...patch });
  emit();
}

// ---------------------------------------------------------------------------
// Hydrate (runs once per tab)
// ---------------------------------------------------------------------------

let hydrating: Promise<void> | null = null;

export function hydrate(): Promise<void> {
  if (hydrating) return hydrating;
  hydrating = (async () => {
    const rows = await db.entries<Batch | Video | Job | Export>(db.RECORDS);
    for (const [k, v] of rows) {
      if (k.startsWith("batch:")) state.batches.set(v.id, v as Batch);
      else if (k.startsWith("video:")) state.videos.set(v.id, v as Video);
      else if (k.startsWith("job:")) state.jobs.set(v.id, v as Job);
      else if (k.startsWith("export:")) state.exports.set(v.id, v as Export);
    }
    // Work that was running when the tab closed goes back in the queue (the "sweep stuck work" job).
    for (const j of state.jobs.values()) if (j.status === "detecting" || j.status === "rendering") await save("job", { ...j, status: "queued", progress: 0 });
    for (const e of state.exports.values()) if (e.status === "rendering") await save("export", { ...e, status: "queued", progress: 0 });
    for (const v of state.videos.values()) if (v.status === "uploading" || v.status === "probing") await save("video", { ...v, status: "rejected", rejectReason: "corrupt" });
    await expireOld();
    state.hydrated = true;
    emit();
    kickWorker();
  })();
  return hydrating;
}

async function expireOld() {
  const now = Date.now();
  for (const b of [...state.batches.values()]) if (new Date(b.expiresAt).getTime() < now) await deleteBatch(b.id);
}

// ---------------------------------------------------------------------------
// Plan + quota (demo only: no payments yet, the plan is a local setting)
// ---------------------------------------------------------------------------

const PLAN_KEY = "cleanup.demoPlan";
const QUOTA_KEY = "cleanup.quota";
const ATTEST_KEY = "cleanup.attested";

function read<T>(k: string): T | null {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode: limits reset on reload, acceptable for the demo layer */
  }
}

export function getPlan(): Plan {
  const id = read<PlanId>(PLAN_KEY);
  return PLANS[id && id in PLANS ? id : "guest"];
}

export function setDemoPlan(id: PlanId) {
  write(PLAN_KEY, id);
  emit();
}

function quota(): QuotaState {
  return forDate(read<QuotaState>(QUOTA_KEY), utcDate());
}

export function quotaStatus() {
  const plan = getPlan();
  const q = quota();
  return {
    previewsLeft: remaining(q, "preview", plan.previewsPerDay),
    previewsCap: plan.previewsPerDay,
    exportsLeft: remaining(q, "export", plan.exportsPerDay),
    exportsCap: plan.exportsPerDay,
    resetsInHours: hoursUntilUtcMidnight(),
  };
}

function take(kind: QuotaKind): boolean {
  const plan = getPlan();
  const next = consume(quota(), kind, kind === "preview" ? plan.previewsPerDay : plan.exportsPerDay);
  if (!next) return false;
  write(QUOTA_KEY, next);
  emit();
  return true;
}

function giveBack(kind: QuotaKind, date: string) {
  write(QUOTA_KEY, refund(quota(), kind, date));
  emit();
}

export function hasAttested(): boolean {
  return read<string>(ATTEST_KEY) === ATTESTATION_VERSION;
}

export function setAttested(on: boolean) {
  write(ATTEST_KEY, on ? ATTESTATION_VERSION : null);
  emit();
}

// ---------------------------------------------------------------------------
// Batches + videos  (POST /api/batches, POST /api/videos, .../complete, DELETE)
// ---------------------------------------------------------------------------

export async function createBatch(): Promise<Batch> {
  await hydrate();
  const now = new Date();
  const batch: Batch = {
    id: uid(),
    name: null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + getPlan().retentionDays * 86_400_000).toISOString(),
  };
  await save("batch", batch);
  return batch;
}

export type Rejection = { filename: string; reason: RejectReason | "batch_full" | "no_attestation" };

export function liveVideos(batchId: string): Video[] {
  return [...state.videos.values()].filter((v) => v.batchId === batchId && v.status !== "deleted").sort((a, b) => a.position - b.position);
}

/**
 * Checks each file, stores it, and starts the pipeline (probe -> first job).
 * Returns at once with what was accepted; probing and rendering continue in the background.
 */
export async function addVideos(batchId: string, files: File[], source: Video["source"] = "upload"): Promise<{ added: Video[]; rejected: Rejection[] }> {
  await hydrate();
  const plan = getPlan();
  const rejected: Rejection[] = [];
  const added: Video[] = [];
  if (!hasAttested()) return { added, rejected: files.map((f) => ({ filename: f.name, reason: "no_attestation" })) };
  let count = liveVideos(batchId).length;
  for (const file of files) {
    if (count >= BATCH_LIMIT) { rejected.push({ filename: file.name, reason: "batch_full" }); continue; }
    if (!(ACCEPTED_TYPES.includes(file.type) || (file.type === "" && /\.(mp4|mov|webm|mkv)$/i.test(file.name)))) { rejected.push({ filename: file.name, reason: "unsupported" }); continue; }
    if (file.size > plan.maxBytes) { rejected.push({ filename: file.name, reason: "too_large" }); continue; }
    const video: Video = {
      id: uid(), batchId, position: count++, source, filename: file.name || "video", contentType: file.type || "video/mp4",
      sizeBytes: file.size, status: "uploading", rejectReason: null, durationMs: null, width: null, height: null, thumbnail: null,
      rightsAttestedAt: new Date().toISOString(), attestationVersion: ATTESTATION_VERSION, createdAt: new Date().toISOString(),
    };
    await save("video", video);
    added.push(video);
    void ingest(video, file);
  }
  return { added, rejected };
}

async function ingest(video: Video, file: File) {
  try {
    await db.put(db.BLOBS, key.original(video.id), file);
    await save("video", { ...state.videos.get(video.id)!, status: "probing" });
    const p = await probe(file);
    const plan = getPlan();
    const tooLong = p.durationMs > plan.maxDurationMs;
    await save("video", {
      ...state.videos.get(video.id)!,
      status: tooLong ? "rejected" : "ready",
      rejectReason: tooLong ? "too_long" : null,
      durationMs: p.durationMs, width: p.width, height: p.height, thumbnail: p.thumbnail,
    });
    if (!tooLong) await createJob(video.id, { autoDetect: true });
  } catch {
    const cur = state.videos.get(video.id);
    if (cur) await save("video", { ...cur, status: "rejected", rejectReason: "corrupt" });
  }
}

export async function removeVideo(videoId: string) {
  const v = state.videos.get(videoId);
  if (!v) return;
  for (const j of jobsFor(videoId)) if (!isFinished(j)) await cancelJob(j.id);
  await save("video", { ...v, status: "deleted" });
  await db.del(db.BLOBS, key.original(videoId));
  dropUrl(key.original(videoId));
}

async function deleteBatch(batchId: string) {
  for (const v of [...state.videos.values()].filter((v) => v.batchId === batchId)) {
    for (const j of jobsFor(v.id)) {
      for (const e of exportsFor(j.id)) { state.exports.delete(e.id); await db.del(db.RECORDS, key.export(e.id)); await db.del(db.BLOBS, key.result(e.id)); }
      state.jobs.delete(j.id); await db.del(db.RECORDS, key.job(j.id)); await db.del(db.BLOBS, key.preview(j.id));
    }
    state.videos.delete(v.id); await db.del(db.RECORDS, key.video(v.id)); await db.del(db.BLOBS, key.original(v.id));
  }
  state.batches.delete(batchId);
  await db.del(db.RECORDS, key.batch(batchId));
  emit();
}

/** DELETE /api/account, for the browser: wipe every record and file. */
export async function deleteEverything() {
  await db.clearAll();
  state.batches.clear(); state.videos.clear(); state.jobs.clear(); state.exports.clear();
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls.clear();
  try { localStorage.removeItem(QUOTA_KEY); localStorage.removeItem(ATTEST_KEY); } catch { /* ignore */ }
  emit();
}

// ---------------------------------------------------------------------------
// Jobs  (POST /api/videos/:id/jobs, cancel, retry)
// ---------------------------------------------------------------------------

export function jobsFor(videoId: string): Job[] {
  return [...state.jobs.values()].filter((j) => j.videoId === videoId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function latestJob(videoId: string): Job | null {
  const js = jobsFor(videoId);
  return js.length ? js[js.length - 1] : null;
}

export function isFinished(j: Job): boolean {
  return j.status === "done" || j.status === "failed" || j.status === "canceled";
}

/** The mask a job actually used: the user's regions plus detected ones. */
export function effectiveMask(job: Job): Mask {
  return mergeMasks(job.mask, job.detectedMask);
}

export type CreateJobResult = { ok: true; job: Job } | { ok: false; reason: "daily_cap"; resetsInHours: number } | { ok: false; reason: "not_ready" };

export async function createJob(
  videoId: string,
  opts: { mask?: Mask; autoDetect?: boolean; parentJobId?: string | null; mode?: RemovalMode } = {},
): Promise<CreateJobResult> {
  const v = state.videos.get(videoId);
  if (!v || v.status !== "ready") return { ok: false, reason: "not_ready" };
  if (!take("preview")) return { ok: false, reason: "daily_cap", resetsInHours: hoursUntilUtcMidnight() };
  const job: Job = {
    id: uid(), videoId, parentJobId: opts.parentJobId ?? null, mode: opts.mode ?? "watermark",
    autoDetect: opts.autoDetect ?? true, mask: opts.mask ?? { regions: [] }, detectedMask: null,
    status: "queued", progress: 0, errorCode: null, errorMessage: null, previewMs: null,
    createdAt: new Date().toISOString(), finishedAt: null, quotaDate: utcDate(),
  };
  await save("job", job);
  kickWorker();
  return { ok: true, job };
}

export async function cancelJob(jobId: string) {
  const j = state.jobs.get(jobId);
  if (!j || isFinished(j)) return;
  if (running?.id === jobId) running.abort.abort();
  await save("job", { ...j, status: "canceled", finishedAt: new Date().toISOString() });
  giveBack("preview", j.quotaDate);
}

export async function retryJob(jobId: string): Promise<CreateJobResult> {
  const j = state.jobs.get(jobId);
  if (!j) return { ok: false, reason: "not_ready" };
  return createJob(j.videoId, { mask: j.mask, autoDetect: j.autoDetect, parentJobId: j.parentJobId, mode: j.mode });
}

// ---------------------------------------------------------------------------
// Exports  (POST /api/jobs/:id/exports)
// ---------------------------------------------------------------------------

export function exportsFor(jobId: string): Export[] {
  return [...state.exports.values()].filter((e) => e.jobId === jobId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export type CreateExportResult =
  | { ok: true; export: Export }
  | { ok: false; reason: "upgrade" | "busy" | "not_ready" }
  | { ok: false; reason: "daily_cap"; resetsInHours: number };

export async function createExport(jobId: string, resolution: Export["resolution"]): Promise<CreateExportResult> {
  const job = state.jobs.get(jobId);
  if (!job || job.status !== "done") return { ok: false, reason: "not_ready" };
  if (!resolutionAllowed(getPlan(), resolution)) return { ok: false, reason: "upgrade" };
  // Same rule as the partial unique index: one live export per job and resolution.
  if (exportsFor(jobId).some((e) => e.resolution === resolution && e.status !== "failed")) return { ok: false, reason: "busy" };
  if (!take("export")) return { ok: false, reason: "daily_cap", resetsInHours: hoursUntilUtcMidnight() };
  const ex: Export = { id: uid(), jobId, resolution, status: "queued", progress: 0, sizeBytes: null, errorMessage: null, createdAt: new Date().toISOString(), finishedAt: null };
  await save("export", ex);
  kickWorker();
  return { ok: true, export: ex };
}

// ---------------------------------------------------------------------------
// Files: object URLs for originals, previews, exports
// ---------------------------------------------------------------------------

const urls = new Map<string, string>();

function dropUrl(k: string) {
  const u = urls.get(k);
  if (u) URL.revokeObjectURL(u);
  urls.delete(k);
}

export async function fileUrl(kind: "original" | "preview" | "result", id: string): Promise<string | null> {
  const k = key[kind](id);
  const cached = urls.get(k);
  if (cached) return cached;
  const blob = await db.get<Blob>(db.BLOBS, k);
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urls.set(k, u);
  return u;
}

export async function fileBlob(kind: "original" | "preview" | "result", id: string): Promise<Blob | null> {
  return (await db.get<Blob>(db.BLOBS, key[kind](id))) ?? null;
}

// ---------------------------------------------------------------------------
// Worker: one render at a time in this tab (the GPU worker runs many in parallel)
// ---------------------------------------------------------------------------

let running: { id: string; abort: AbortController } | null = null;
let working = false;

export function queuePosition(jobId: string): number {
  const queued = [...state.jobs.values()].filter((j) => j.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const i = queued.findIndex((j) => j.id === jobId);
  return i < 0 ? 0 : i + 1 + (running ? 1 : 0);
}

function kickWorker() {
  if (working || !state.hydrated) return;
  working = true;
  void (async () => {
    try {
      for (;;) {
        const nextExport = [...state.exports.values()].filter((e) => e.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
        const nextJob = [...state.jobs.values()].filter((j) => j.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
        if (nextJob) await runJob(nextJob);
        else if (nextExport) await runExport(nextExport);
        else break;
      }
    } finally {
      working = false;
    }
  })();
}

async function runJob(job: Job) {
  const abort = new AbortController();
  running = { id: job.id, abort };
  const still = () => state.jobs.get(job.id)?.status !== "canceled";
  try {
    const source = await fileBlob("original", job.videoId);
    if (!source) throw new RenderError("render_failed", "The original file is missing.");
    let detected: Mask | null = null;
    if (job.autoDetect && !hasErase(job.mask)) {
      await save("job", { ...job, status: "detecting", progress: 0 });
      const { frames, W, H } = await sampleFrames(source, 12);
      const boxes = detectStatic(frames, W, H);
      detected = {
        regions: boxes.map<Region>((b) => ({
          id: uid(), kind: "erase", shape: "rect", x: b.x, y: b.y, w: b.w, h: b.h,
          tStartMs: 0, tEndMs: null, track: false, source: "auto",
        })),
      };
      if (!still()) return;
      if (!detected.regions.length) {
        await save("job", { ...state.jobs.get(job.id)!, status: "failed", detectedMask: detected, errorCode: "nothing_found", errorMessage: "We couldn't find a watermark. Mark it yourself and clean again.", finishedAt: new Date().toISOString() });
        giveBack("preview", job.quotaDate);
        return;
      }
    }
    if (!still()) return;
    await save("job", { ...state.jobs.get(job.id)!, status: "rendering", detectedMask: detected, progress: 0 });
    const out = await render(source, mergeMasks(job.mask, detected), {
      limitMs: PREVIEW_MS,
      maxHeight: 720,
      signal: abort.signal,
      onProgress: (pct) => patchLive(state.jobs, job.id, { progress: pct }),
    });
    if (!still()) return;
    await db.put(db.BLOBS, key.preview(job.id), out.blob);
    dropUrl(key.preview(job.id));
    await save("job", { ...state.jobs.get(job.id)!, status: "done", progress: 100, previewMs: out.durationMs, finishedAt: new Date().toISOString() });
  } catch (e) {
    if (!still()) return;
    const err = e instanceof RenderError ? e : new RenderError("render_failed", "Something went wrong while cleaning.");
    await save("job", {
      ...state.jobs.get(job.id)!, status: "failed",
      errorCode: err.code === "unsupported_browser" ? "unsupported_browser" : "render_failed",
      errorMessage: err.code === "unsupported_browser" ? err.message : "The cleaner stopped partway. Your preview was given back.",
      finishedAt: new Date().toISOString(),
    });
    giveBack("preview", job.quotaDate);
  } finally {
    running = null;
  }
}

async function runExport(ex: Export) {
  const abort = new AbortController();
  running = { id: ex.id, abort };
  const job = state.jobs.get(ex.jobId);
  try {
    if (!job) throw new Error("missing job");
    const source = await fileBlob("original", job.videoId);
    if (!source) throw new Error("missing original");
    await save("export", { ...ex, status: "rendering", progress: 0 });
    const height = RESOLUTIONS.find((r) => r.id === ex.resolution)!.height;
    const out = await render(source, effectiveMask(job), {
      limitMs: null,
      maxHeight: height,
      signal: abort.signal,
      onProgress: (pct) => patchLive(state.exports, ex.id, { progress: pct }),
    });
    await db.put(db.BLOBS, key.result(ex.id), out.blob);
    await save("export", { ...state.exports.get(ex.id)!, status: "done", progress: 100, sizeBytes: out.blob.size, finishedAt: new Date().toISOString() });
  } catch {
    await save("export", { ...state.exports.get(ex.id)!, status: "failed", errorMessage: "The export stopped partway. Your export was given back.", finishedAt: new Date().toISOString() });
    giveBack("export", ex.createdAt.slice(0, 10));
  } finally {
    running = null;
  }
}
