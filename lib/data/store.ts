"use client";
// Data layer, server edition. Same functions the screens used with the fake layer:
// - reads: RLS selects + Supabase Realtime (live cards, plan, quota)
// - writes: the API routes in app/api (ownership, limits and quota are enforced there)
// - work: this tab is a worker. It claims queued previews/exports for this user, runs the
//   in-browser engine and uploads the result. A GPU worker will claim the same queue later.

import { detectStatic } from "../engine/detect";
import { render, RenderError } from "../engine/render";
import { pickRecorderType, probe, sampleFrames } from "../engine/video";
import { hoursUntilUtcMidnight, uid, utcDate } from "../format";
import { mergeMasks } from "../mask";
import { ACCEPTED_TYPES, ATTESTATION_VERSION, BATCH_LIMIT, PLANS, PREVIEW_MS, RESOLUTIONS, type Plan } from "../plans";
import { fileUrl as apiFileUrl, planIdFor, toBatch, toExport, toJob, toProfile, toVideo } from "../rows";
import type { Batch, Export, Job, Mask, Profile, RejectReason, Region, RemovalMode, Video } from "../types";
import { MEDIA_BUCKET } from "../supabase/env";
import { supabaseBrowser } from "../supabase/client";

// ---------------------------------------------------------------------------
// State + change notification
// ---------------------------------------------------------------------------

type State = {
  hydrated: boolean;
  userId: string | null;
  profile: Profile | null;
  usage: { preview: number; export: number; date: string };
  batches: Map<string, Batch>;
  videos: Map<string, Video>;
  jobs: Map<string, Job>;
  exports: Map<string, Export>;
};

const state: State = {
  hydrated: false, userId: null, profile: null, usage: { preview: 0, export: 0, date: utcDate() },
  batches: new Map(), videos: new Map(), jobs: new Map(), exports: new Map(),
};
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

function putVideo(v: Video) {
  if (v.status === "deleted") state.videos.delete(v.id);
  else state.videos.set(v.id, v);
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "POST",
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string } }).error ?? {};
    throw new ApiError(res.status, e.code ?? "error", e.message ?? "Something went wrong.", e as Record<string, unknown>);
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Session + hydrate
// ---------------------------------------------------------------------------

let hydrating: Promise<void> | null = null;

export function hydrate(): Promise<void> {
  if (hydrating) return hydrating;
  hydrating = (async () => {
    const sb = supabaseBrowser();
    const { data } = await sb.auth.getUser();
    if (data.user) await loadFor(data.user.id);
    state.hydrated = true;
    emit();
    sb.auth.onAuthStateChange((event, session) => {
      const id = session?.user.id ?? null;
      if (id && id !== state.userId) void loadFor(id).then(emit);
      if (!id && state.userId) reset();
      if (event === "USER_UPDATED" && id) void refreshProfile();
    });
  })();
  return hydrating;
}

function reset() {
  state.userId = null; state.profile = null;
  state.batches.clear(); state.videos.clear(); state.jobs.clear(); state.exports.clear();
  state.usage = { preview: 0, export: 0, date: utcDate() };
  channel?.unsubscribe();
  channel = null;
  emit();
}

/** A session for writing: the current user, or a new anonymous guest. */
async function ensureSession(): Promise<string> {
  await hydrate();
  if (state.userId) return state.userId;
  const sb = supabaseBrowser();
  const { data, error } = await sb.auth.signInAnonymously();
  if (error || !data.user) throw new ApiError(503, "no_session", "Couldn't start a guest session. Try again in a moment.");
  await loadFor(data.user.id);
  emit();
  return data.user.id;
}

async function loadFor(userId: string) {
  const sb = supabaseBrowser();
  state.userId = userId;
  const [p, b, v, j, e] = await Promise.all([
    sb.from("profiles").select("*").eq("id", userId).maybeSingle(),
    sb.from("batches").select("*").order("created_at", { ascending: false }),
    sb.from("videos").select("*").order("position"),
    sb.from("removal_jobs").select("*").order("created_at"),
    sb.from("exports").select("*").order("created_at"),
  ]);
  state.profile = p.data ? toProfile(p.data) : null;
  state.batches = new Map((b.data ?? []).map((r) => [String(r.id), toBatch(r)]));
  state.videos = new Map((v.data ?? []).map((r) => [String(r.id), toVideo(r)]));
  state.jobs = new Map((j.data ?? []).map((r) => [String(r.id), toJob(r)]));
  state.exports = new Map((e.data ?? []).map((r) => [String(r.id), toExport(r)]));
  await refreshUsage();
  listen(userId);
  kickWorker();
}

async function refreshProfile() {
  if (!state.userId) return;
  const { data } = await supabaseBrowser().from("profiles").select("*").eq("id", state.userId).maybeSingle();
  state.profile = data ? toProfile(data) : null;
  emit();
}

async function refreshUsage() {
  const today = utcDate();
  const { data } = await supabaseBrowser().from("usage_daily").select("kind, count").eq("usage_date", today);
  const u = { preview: 0, export: 0, date: today };
  for (const r of (data ?? []) as { kind: "preview" | "export"; count: number }[]) u[r.kind] = r.count;
  state.usage = u;
  emit();
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

let channel: ReturnType<ReturnType<typeof supabaseBrowser>["channel"]> | null = null;

function listen(userId: string) {
  channel?.unsubscribe();
  const sb = supabaseBrowser();
  const filter = `user_id=eq.${userId}`;
  channel = sb
    .channel(`user-${userId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "videos", filter }, (p) => {
      if (p.eventType === "DELETE") state.videos.delete(String((p.old as { id: string }).id));
      else putVideo(toVideo(p.new));
      emit();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "removal_jobs", filter }, (p) => {
      if (p.eventType === "DELETE") return;
      const job = toJob(p.new);
      state.jobs.set(job.id, job);
      if (running?.id === job.id && job.status === "canceled") running.abort.abort();
      if (job.status === "queued") kickWorker();
      emit();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "exports", filter }, (p) => {
      if (p.eventType === "DELETE") return;
      const ex = toExport(p.new);
      state.exports.set(ex.id, ex);
      if (ex.status === "queued") kickWorker();
      emit();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "usage_daily", filter }, () => void refreshUsage())
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` }, (p) => {
      state.profile = toProfile(p.new);
      emit();
    })
    .subscribe();
}

// ---------------------------------------------------------------------------
// Plan + quota
// ---------------------------------------------------------------------------

export function getPlan(): Plan {
  return PLANS[planIdFor(state.profile)];
}

/** Development only: the server refuses unless ALLOW_DEMO_PLAN=1 outside production. */
export async function setDemoPlan(id: "free" | "plus" | "pro") {
  await ensureSession();
  await api("/api/dev/plan", { body: { plan: id } });
  await refreshProfile();
}

export function quotaStatus() {
  const plan = getPlan();
  const u = state.usage.date === utcDate() ? state.usage : { preview: 0, export: 0 };
  return {
    previewsLeft: Math.max(0, plan.previewsPerDay - u.preview),
    previewsCap: plan.previewsPerDay,
    exportsLeft: Math.max(0, plan.exportsPerDay - u.export),
    exportsCap: plan.exportsPerDay,
    resetsInHours: hoursUntilUtcMidnight(),
  };
}

const ATTEST_KEY = "cleanup.attested";
export function hasAttested(): boolean {
  try { return localStorage.getItem(ATTEST_KEY) === ATTESTATION_VERSION; } catch { return false; }
}
export function setAttested(on: boolean) {
  try { if (on) localStorage.setItem(ATTEST_KEY, ATTESTATION_VERSION); else localStorage.removeItem(ATTEST_KEY); } catch { /* ignore */ }
  emit();
}

// ---------------------------------------------------------------------------
// Batches + videos
// ---------------------------------------------------------------------------

export async function createBatch(): Promise<Batch> {
  await ensureSession();
  const { batch: b } = await api<{ batch: Batch }>("/api/batches");
  state.batches.set(b.id, b);
  emit();
  return b;
}

export type Rejection = { filename: string; reason: RejectReason | "batch_full" | "no_attestation" | "failed"; message?: string; durationMs?: number };

export function liveVideos(batchId: string): Video[] {
  return [...state.videos.values()].filter((v) => v.batchId === batchId && v.status !== "deleted").sort((a, b) => a.position - b.position);
}

function guessType(f: File): string {
  if (f.type) return f.type;
  const ext = f.name.split(".").pop()?.toLowerCase();
  return ({ mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska" } as Record<string, string>)[ext ?? ""] ?? "";
}

/**
 * Probe each file here first (so a broken or too-long file never uploads), record it on the
 * server, then upload straight to storage in the background and mark it complete.
 */
export async function addVideos(batchId: string, files: File[], source: "upload" | "sample" = "upload"): Promise<{ added: Video[]; rejected: Rejection[] }> {
  await ensureSession();
  const plan = getPlan();
  const rejected: Rejection[] = [];
  const added: Video[] = [];
  if (!hasAttested()) return { added, rejected: files.map((f) => ({ filename: f.name, reason: "no_attestation" })) };
  let count = liveVideos(batchId).length;
  for (const file of files) {
    const type = guessType(file);
    if (count >= BATCH_LIMIT) { rejected.push({ filename: file.name, reason: "batch_full" }); continue; }
    if (!ACCEPTED_TYPES.includes(type)) { rejected.push({ filename: file.name, reason: "unsupported" }); continue; }
    if (file.size > plan.maxBytes) { rejected.push({ filename: file.name, reason: "too_large" }); continue; }
    let meta;
    try { meta = await probe(file); } catch { rejected.push({ filename: file.name, reason: "corrupt" }); continue; }
    if (meta.durationMs > plan.maxDurationMs) { rejected.push({ filename: file.name, reason: "too_long", durationMs: meta.durationMs }); continue; }
    try {
      const res = await api<{ video: Video; upload: { path: string; token: string } }>("/api/videos", {
        body: { batchId, filename: file.name || "video", contentType: type, sizeBytes: file.size, source, attest: true, attestationVersion: ATTESTATION_VERSION },
      });
      const video = res.video;
      putVideo(video);
      count++;
      added.push(video);
      emit();
      void upload(video, file, type, res.upload, meta);
    } catch (e) {
      rejected.push({ filename: file.name, reason: e instanceof ApiError && e.code === "batch_full" ? "batch_full" : "failed", message: e instanceof Error ? e.message : undefined });
    }
  }
  return { added, rejected };
}

// Uploads run in the page that started them. Each one stamps localStorage every few seconds, so
// any tab in this browser can tell a live upload from one a refresh or a closed tab cut short.
const UPLOAD_KEY = (id: string) => `cleanup.upload.${id}`;
const failedUploads = new Set<string>();
const UPLOAD_GRACE_MS = 20_000;

function stampUpload(id: string, on: boolean) {
  try { if (on) localStorage.setItem(UPLOAD_KEY(id), String(Date.now())); else localStorage.removeItem(UPLOAD_KEY(id)); } catch { /* ignore */ }
}

/** True when a card says "uploading" but nothing in this browser is uploading it any more. */
export function uploadStalled(video: Video): boolean {
  if (video.status !== "uploading") return false;
  if (failedUploads.has(video.id)) return true;
  let last = 0;
  try { last = Number(localStorage.getItem(UPLOAD_KEY(video.id)) ?? 0); } catch { /* ignore */ }
  const now = Date.now();
  return now - last > 10_000 && now - new Date(video.createdAt).getTime() > UPLOAD_GRACE_MS;
}

async function upload(video: Video, file: File, type: string, target: { path: string; token: string }, meta: Awaited<ReturnType<typeof probe>>) {
  originals.set(video.id, file); // keep it for this tab's worker: no need to download it again
  stampUpload(video.id, true);
  const stamp = setInterval(() => stampUpload(video.id, true), 3_000);
  try {
    const { error } = await supabaseBrowser().storage.from(MEDIA_BUCKET).uploadToSignedUrl(target.path, target.token, file, { contentType: type });
    if (error) throw error;
    const res = await api<{ video: Video; job: Job | null }>(`/api/videos/${video.id}/complete`, {
      body: { durationMs: meta.durationMs, width: meta.width, height: meta.height, thumbnail: meta.thumbnail },
    });
    putVideo(res.video);
    if (res.job) state.jobs.set(res.job.id, res.job);
    emit();
    void refreshUsage();
    kickWorker();
  } catch {
    // The card shows "Upload stopped" with a Remove button; the sweep job deletes it after 3 h.
    failedUploads.add(video.id);
    emit();
  } finally {
    clearInterval(stamp);
    stampUpload(video.id, false);
  }
}

export async function removeVideo(videoId: string) {
  await api(`/api/videos/${videoId}`, { method: "DELETE" });
  state.videos.delete(videoId);
  originals.delete(videoId);
  emit();
}

/** Delete the account and everything in it (server), then sign out here. */
export async function deleteEverything() {
  await api("/api/account", { method: "DELETE" });
  await supabaseBrowser().auth.signOut({ scope: "local" });
  reset();
}

export async function signOut(everywhere = false) {
  await supabaseBrowser().auth.signOut({ scope: everywhere ? "global" : "local" });
  reset();
}

// ---------------------------------------------------------------------------
// Jobs
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
export function effectiveMask(job: Job): Mask {
  return mergeMasks(job.mask, job.detectedMask);
}

export type CreateJobResult = { ok: true; job: Job } | { ok: false; reason: "daily_cap"; resetsInHours: number } | { ok: false; reason: "not_ready" };

function capOrThrow(e: unknown): { ok: false; reason: "daily_cap"; resetsInHours: number } | { ok: false; reason: "not_ready" } {
  if (e instanceof ApiError && e.code === "daily_cap") return { ok: false, reason: "daily_cap", resetsInHours: Number(e.extra.resetsInHours ?? hoursUntilUtcMidnight()) };
  if (e instanceof ApiError && (e.code === "not_ready" || e.code === "invalid")) return { ok: false, reason: "not_ready" };
  throw e;
}

export async function createJob(
  videoId: string,
  opts: { mask?: Mask; autoDetect?: boolean; parentJobId?: string | null; mode?: RemovalMode } = {},
): Promise<CreateJobResult> {
  try {
    const { job: j } = await api<{ job: Job }>(`/api/videos/${videoId}/jobs`, {
      body: { mask: opts.mask ?? { regions: [] }, autoDetect: opts.autoDetect ?? true, parentJobId: opts.parentJobId ?? null, mode: opts.mode ?? "watermark" },
    });
    state.jobs.set(j.id, j);
    emit();
    void refreshUsage();
    kickWorker();
    return { ok: true, job: j };
  } catch (e) {
    return capOrThrow(e);
  }
}

export async function cancelJob(jobId: string) {
  if (running?.id === jobId) running.abort.abort();
  try {
    const { job } = await api<{ job: Job }>(`/api/jobs/${jobId}/cancel`);
    state.jobs.set(jobId, job);
    emit();
    void refreshUsage();
  } catch {
    // Already finished or moved on: show what the server has.
    await reloadJob(jobId).catch(() => {});
  }
}

/** Re-read one job from the server, when this tab's copy may be out of date. */
async function reloadJob(jobId: string) {
  const { data } = await supabaseBrowser().from("removal_jobs").select("*").eq("id", jobId).maybeSingle();
  if (data) { state.jobs.set(jobId, toJob(data)); emit(); }
}

export type RetryResult = CreateJobResult | { ok: false; reason: "refused"; message: string };

export async function retryJob(jobId: string): Promise<RetryResult> {
  try {
    const { job: j } = await api<{ job: Job }>(`/api/jobs/${jobId}/retry`);
    state.jobs.set(j.id, j);
    emit();
    void refreshUsage();
    kickWorker();
    return { ok: true, job: j };
  } catch (e) {
    if (e instanceof ApiError && e.code === "daily_cap") return capOrThrow(e);
    // Anything else (the job moved on, a network blip): show the real state instead of crashing.
    await reloadJob(jobId).catch(() => {});
    return { ok: false, reason: "refused", message: e instanceof Error ? e.message : "Try again in a moment." };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function exportsFor(jobId: string): Export[] {
  return [...state.exports.values()].filter((e) => e.jobId === jobId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export type CreateExportResult =
  | { ok: true; export: Export }
  | { ok: false; reason: "upgrade" | "busy" | "not_ready" }
  | { ok: false; reason: "daily_cap"; resetsInHours: number };

export async function createExport(jobId: string, resolution: Export["resolution"]): Promise<CreateExportResult> {
  try {
    const { export: ex } = await api<{ export: Export }>(`/api/jobs/${jobId}/exports`, { body: { resolution } });
    state.exports.set(ex.id, ex);
    emit();
    void refreshUsage();
    kickWorker();
    return { ok: true, export: ex };
  } catch (e) {
    if (e instanceof ApiError && e.code === "upgrade") return { ok: false, reason: "upgrade" };
    if (e instanceof ApiError && e.code === "busy") return { ok: false, reason: "busy" };
    if (e instanceof ApiError && e.code === "daily_cap") return { ok: false, reason: "daily_cap", resetsInHours: Number(e.extra.resetsInHours ?? 1) };
    return { ok: false, reason: "not_ready" };
  }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** Same-origin URL that redirects to a short-lived signed URL. Pass a filename to download. */
export function fileUrl(kind: "original" | "preview" | "result", id: string, download?: string): string {
  return apiFileUrl(kind, id, download);
}

const originals = new Map<string, Blob>();

async function originalBlob(videoId: string): Promise<Blob> {
  const cached = originals.get(videoId);
  if (cached) return cached;
  const res = await fetch(apiFileUrl("original", videoId));
  if (!res.ok) throw new RenderError("render_failed", "Couldn't load the original.");
  const blob = await res.blob();
  originals.set(videoId, blob);
  return blob;
}

// ---------------------------------------------------------------------------
// Worker (this tab)
// ---------------------------------------------------------------------------

const workerId = typeof crypto !== "undefined" ? `tab-${uid()}` : "tab";
let running: { id: string; abort: AbortController } | null = null;
let working = false;

export function queuePosition(jobId: string): number {
  const queued = [...state.jobs.values()].filter((j) => j.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const i = queued.findIndex((j) => j.id === jobId);
  const active = [...state.jobs.values()].some((j) => j.status === "detecting" || j.status === "rendering");
  return i < 0 ? 0 : i + 1 + (active ? 1 : 0);
}

function kickWorker() {
  if (working || !state.userId || typeof window === "undefined" || !pickRecorderType()) return;
  working = true;
  void (async () => {
    try {
      for (;;) {
        const { work } = await api<{ work: null | { kind: "job"; job: Job } | { kind: "export"; export: Export } }>("/api/worker/claim", { body: { workerId } });
        if (!work) break;
        if (work.kind === "job") await runJob(work.job);
        else await runExport(work.export);
      }
    } catch {
      /* network blip: the poll below or the next event retries */
    } finally {
      working = false;
    }
  })();
}

// Fallback poll: picks up queued work if a Realtime event was missed, and work a refreshed or
// closed tab left half done (the server hands it over once it has been quiet for 30 s).
if (typeof window !== "undefined") {
  setInterval(() => {
    const jobs = [...state.jobs.values()], exps = [...state.exports.values()];
    const queued = jobs.some((j) => j.status === "queued") || exps.some((e) => e.status === "queued");
    const orphaned = !running && (jobs.some((j) => j.status === "detecting" || j.status === "rendering") || exps.some((e) => e.status === "rendering"));
    if (queued || orphaned) kickWorker();
    if ([...state.videos.values()].some((v) => v.status === "uploading")) emit(); // lets cards notice a stalled upload
  }, 10_000);
}

function throttle(fn: (pct: number) => void, ms: number) {
  let last = 0;
  return (pct: number) => {
    const now = Date.now();
    if (now - last >= ms || pct >= 100) { last = now; fn(pct); }
  };
}

async function report(kind: "jobs" | "exports", id: string, body: Record<string, unknown>, abort: AbortController) {
  try {
    await api(`/api/worker/${kind}/${id}/progress`, { body: { workerId, ...body } });
  } catch (e) {
    if (e instanceof ApiError && e.code === "not_held") abort.abort(); // canceled or reassigned
  }
}

async function uploadOutput(kind: "jobs" | "exports", id: string, blob: Blob) {
  const contentType = blob.type.startsWith("video/mp4") ? "video/mp4" : "video/webm";
  const { upload } = await api<{ upload: { path: string; token: string } }>(`/api/worker/${kind}/${id}/upload-url`, { body: { workerId, contentType } });
  const { error } = await supabaseBrowser().storage.from(MEDIA_BUCKET).uploadToSignedUrl(upload.path, upload.token, blob, { contentType });
  if (error) throw new RenderError("render_failed", "Upload of the result failed.");
}

/** Keeps the claim alive while a step reports nothing (detection, upload of the result). */
function heartbeat(kind: "jobs" | "exports", id: string, abort: AbortController, pct: () => number) {
  const t = setInterval(() => void report(kind, id, { progress: pct() }, abort), 10_000);
  return () => clearInterval(t);
}

async function runJob(job: Job) {
  const abort = new AbortController();
  running = { id: job.id, abort };
  const stopBeat = heartbeat("jobs", job.id, abort, () => state.jobs.get(job.id)?.progress ?? 0);
  state.jobs.set(job.id, job);
  emit();
  let detected: Mask | null = null;
  try {
    const source = await originalBlob(job.videoId);
    if (job.autoDetect) {
      const { frames, W, H } = await sampleFrames(source, 12);
      const boxes = detectStatic(frames, W, H);
      detected = {
        regions: boxes.map<Region>((b) => ({ id: uid(), kind: "erase", shape: "rect", x: b.x, y: b.y, w: b.w, h: b.h, tStartMs: 0, tEndMs: null, track: false, source: "auto" })),
      };
      if (!detected.regions.length) {
        await api(`/api/worker/jobs/${job.id}/complete`, { body: { workerId, ok: false, errorCode: "nothing_found", detectedMask: detected } });
        return;
      }
      await report("jobs", job.id, { progress: 0, status: "rendering", detectedMask: detected }, abort);
    }
    if (abort.signal.aborted) return;
    const tick = throttle((pct) => void report("jobs", job.id, { progress: pct }, abort), 1000);
    const out = await render(source, mergeMasks(job.mask, detected), {
      limitMs: PREVIEW_MS, maxHeight: 720, signal: abort.signal,
      onProgress: (pct) => {
        // A late frame after Cancel must not turn a canceled card back into "Cleaning 99%".
        if (abort.signal.aborted) return;
        const cur = state.jobs.get(job.id);
        if (cur && (cur.status === "detecting" || cur.status === "rendering")) { state.jobs.set(job.id, { ...cur, status: "rendering", progress: pct }); emit(); }
        tick(pct);
      },
    });
    if (abort.signal.aborted) return;
    await uploadOutput("jobs", job.id, out.blob);
    await api(`/api/worker/jobs/${job.id}/complete`, { body: { workerId, ok: true, durationMs: out.durationMs } });
  } catch (e) {
    if (abort.signal.aborted) return;
    const code = e instanceof RenderError && e.code === "unsupported_browser" ? "unsupported_browser" : "render_failed";
    await api(`/api/worker/jobs/${job.id}/complete`, { body: { workerId, ok: false, errorCode: code, ...(detected ? { detectedMask: detected } : {}) } }).catch(() => {});
  } finally {
    stopBeat();
    running = null;
  }
}

async function runExport(ex: Export) {
  const abort = new AbortController();
  running = { id: ex.id, abort };
  const stopBeat = heartbeat("exports", ex.id, abort, () => state.exports.get(ex.id)?.progress ?? 0);
  try {
    let job = state.jobs.get(ex.jobId);
    if (!job) {
      const { data } = await supabaseBrowser().from("removal_jobs").select("*").eq("id", ex.jobId).single();
      if (!data) throw new Error("missing job");
      job = toJob(data);
    }
    const source = await originalBlob(job.videoId);
    const height = RESOLUTIONS.find((r) => r.id === ex.resolution)!.height;
    const tick = throttle((pct) => void report("exports", ex.id, { progress: pct }, abort), 1000);
    const out = await render(source, effectiveMask(job), {
      limitMs: null, maxHeight: height, signal: abort.signal,
      onProgress: (pct) => {
        if (abort.signal.aborted) return;
        const cur = state.exports.get(ex.id);
        if (cur && (cur.status === "queued" || cur.status === "rendering")) { state.exports.set(ex.id, { ...cur, status: "rendering", progress: pct }); emit(); }
        tick(pct);
      },
    });
    if (abort.signal.aborted) return;
    await uploadOutput("exports", ex.id, out.blob);
    await api(`/api/worker/exports/${ex.id}/complete`, { body: { workerId, ok: true, durationMs: out.durationMs } });
  } catch {
    if (!abort.signal.aborted) await api(`/api/worker/exports/${ex.id}/complete`, { body: { workerId, ok: false } }).catch(() => {});
  } finally {
    stopBeat();
    running = null;
  }
}
