// End-to-end API + access-rule test against the local stack and a running dev server.
//   node --env-file=.env.local scripts/test-api.mjs            (BASE defaults to http://localhost:5320)
// Creates two throwaway users with random passwords, exercises every route, checks that
// user B can see or touch nothing of user A's, then deletes both users.
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomBytes } from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:5320";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let passed = 0, failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${detail}`); }
};

async function makeUser(tag) {
  const email = `${tag}-${randomBytes(4).toString("hex")}@example.test`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: s, error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { id: data.user.id, email, token: s.session.access_token, client };
}

const call = (user, method, path, body, headers = {}) =>
  fetch(BASE + path, {
    method, redirect: "manual",
    headers: { ...(user ? { authorization: `Bearer ${user.token}` } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null), location: r.headers.get("location") }));

const tinyVideo = new Uint8Array(randomBytes(2048)); // bytes only; the server never decodes it
const usage = async (uid, kind) => (await admin.from("usage_daily").select("count").eq("user_id", uid).eq("kind", kind).maybeSingle()).data?.count ?? 0;

// A running export worker would claim this script's exports before the checks can.
if (await fetch("http://localhost:5399").then(() => true).catch(() => false)) {
  console.error("An export worker is running (port 5399). Stop it while this script runs; it claims the test's exports.");
  process.exit(2);
}

const A = await makeUser("alice");
const B = await makeUser("bob");
console.log(`users: A=${A.id.slice(0, 8)} B=${B.id.slice(0, 8)}`);

try {
  console.log("\nupload flow (A)");
  const unauth = await call(null, "POST", "/api/batches");
  check("no session -> 401", unauth.status === 401);
  const batch = (await call(A, "POST", "/api/batches")).json.batch;
  check("create batch", !!batch?.id);
  const bad = await call(A, "POST", "/api/videos", { batchId: batch.id, filename: "x.exe", contentType: "application/x-msdownload", sizeBytes: 10, attest: true, attestationVersion: "v" });
  check("wrong type -> 400", bad.status === 400);
  const noAttest = await call(A, "POST", "/api/videos", { batchId: batch.id, filename: "a.webm", contentType: "video/webm", sizeBytes: 10, attestationVersion: "v" });
  check("missing attestation -> 400", noAttest.status === 400);
  const v = await call(A, "POST", "/api/videos", { batchId: batch.id, filename: "a.webm", contentType: "video/webm", sizeBytes: tinyVideo.length, attest: true, attestationVersion: "2026-11-07" });
  check("create video + upload url", v.status === 201 && v.json.upload?.token, JSON.stringify(v.json));
  const video = v.json.video;
  const early = await call(A, "POST", `/api/videos/${video.id}/complete`, { durationMs: 5000, width: 640, height: 360, thumbnail: null });
  check("complete before upload -> 409", early.status === 409);
  const up = await A.client.storage.from("media").uploadToSignedUrl(v.json.upload.path, v.json.upload.token, tinyVideo, { contentType: "video/webm" });
  check("upload to signed url", !up.error, up.error?.message);
  const done = await call(A, "POST", `/api/videos/${video.id}/complete`, { durationMs: 5000, width: 640, height: 360, thumbnail: null });
  check("complete -> ready + first job", done.status === 200 && done.json.video.status === "ready" && done.json.job?.status === "queued", JSON.stringify(done.json));
  const job1 = done.json.job;
  const again = await call(A, "POST", `/api/videos/${video.id}/complete`, { durationMs: 5000, width: 640, height: 360, thumbnail: null });
  check("complete twice -> 409", again.status === 409);

  console.log("\nrow level security");
  for (const t of ["batches", "videos", "removal_jobs", "usage_daily"]) {
    const a = await A.client.from(t).select("*");
    const b = await B.client.from(t).select("*");
    check(`${t}: A sees own rows, B sees none`, (a.data?.length ?? 0) > 0 && (b.data?.length ?? -1) === 0, `A=${a.data?.length} B=${b.data?.length}`);
  }
  const bProfile = await B.client.from("profiles").select("*");
  check("profiles: B sees only own", bProfile.data?.length === 1 && bProfile.data[0].id === B.id);
  const ins = await B.client.from("batches").insert({ user_id: B.id, expires_at: new Date().toISOString() });
  check("client insert refused", !!ins.error);
  const upd = await A.client.from("profiles").update({ plan: "pro" }).eq("id", A.id).select();
  check("client can't upgrade own plan", (upd.data?.length ?? 0) === 0);
  const rpc = await A.client.rpc("consume_quota", { p_user: A.id, p_kind: "preview", p_cap: 99 });
  check("client can't call quota function", !!rpc.error);
  const dl = await B.client.storage.from("media").download(video.original_key ?? `u/${A.id}/${video.id}/original`);
  check("storage: B can't read A's file directly", !!dl.error);
  const dlA = await A.client.storage.from("media").download(`u/${A.id}/${video.id}/original`);
  check("storage: even A can't read without a signed URL", !!dlA.error);

  console.log("\nB against A's records through the API");
  check("files", (await call(B, "GET", `/api/files?kind=original&id=${video.id}`)).status === 404);
  check("new job", (await call(B, "POST", `/api/videos/${video.id}/jobs`, { autoDetect: true })).status === 404);
  check("cancel job", (await call(B, "POST", `/api/jobs/${job1.id}/cancel`)).status === 409);
  check("export", (await call(B, "POST", `/api/jobs/${job1.id}/exports`, { resolution: "720p" })).status === 404);
  check("delete video", (await call(B, "DELETE", `/api/videos/${video.id}`)).status === 404);
  check("add video to A's batch", (await call(B, "POST", "/api/videos", { batchId: batch.id, filename: "b.webm", contentType: "video/webm", sizeBytes: 10, attest: true, attestationVersion: "v" })).status === 404);
  const bClaim = await call(B, "POST", "/api/worker/claim", { workerId: "worker-bob-1" });
  check("B's worker can't claim A's work", bClaim.json?.work === null);
  check("B progress on A's job", (await call(B, "POST", `/api/worker/jobs/${job1.id}/progress`, { workerId: "worker-bob-1", progress: 5 })).status === 409);
  check("A's original via API", (await call(A, "GET", `/api/files?kind=original&id=${video.id}`)).status === 302);

  console.log("\nworker flow (A)");
  const W = "worker-alice-1";
  const claim = await call(A, "POST", "/api/worker/claim", { workerId: W });
  check("claim -> detecting", claim.json?.work?.kind === "job" && claim.json.work.job.id === job1.id && claim.json.work.job.status === "detecting", JSON.stringify(claim.json));
  check("second claim -> nothing", (await call(A, "POST", "/api/worker/claim", { workerId: "worker-alice-2" })).json?.work === null);
  check("other worker can't report", (await call(A, "POST", `/api/worker/jobs/${job1.id}/progress`, { workerId: "worker-alice-2", progress: 10 })).status === 409);
  const det = { regions: [{ id: "auto1", kind: "erase", shape: "rect", x: 0.7, y: 0.85, w: 0.25, h: 0.1, tStartMs: 0, tEndMs: null, track: false, source: "auto" }] };
  check("progress -> rendering", (await call(A, "POST", `/api/worker/jobs/${job1.id}/progress`, { workerId: W, progress: 0, status: "rendering", detectedMask: det })).status === 200);
  const noFile = await call(A, "POST", `/api/worker/jobs/${job1.id}/complete`, { workerId: W, ok: true, durationMs: 5000 });
  check("complete without output -> 409", noFile.status === 409);
  const pu = (await call(A, "POST", `/api/worker/jobs/${job1.id}/upload-url`, { workerId: W, contentType: "video/webm" })).json.upload;
  await A.client.storage.from("media").uploadToSignedUrl(pu.path, pu.token, tinyVideo, { contentType: "video/webm" });
  check("complete -> done", (await call(A, "POST", `/api/worker/jobs/${job1.id}/complete`, { workerId: W, ok: true, durationMs: 5000 })).status === 200);
  const j1 = (await admin.from("removal_jobs").select("*").eq("id", job1.id).single()).data;
  check("job stored done with detected zones", j1.status === "done" && j1.preview_key && j1.detected_mask?.regions?.length === 1);
  check("late complete -> 409", (await call(A, "POST", `/api/worker/jobs/${job1.id}/complete`, { workerId: W, ok: false })).status === 409);
  check("B can't fetch the preview", (await call(B, "GET", `/api/files?kind=preview&id=${job1.id}`)).status === 404);
  const dlLink = await call(A, "GET", `/api/files?kind=preview&id=${job1.id}&download=clip-cleaned.webm`);
  check("A's preview download link names the file", dlLink.status === 302 && /download=clip-cleaned\.webm/.test(dlLink.location ?? ""), dlLink.location);

  console.log("\njobs, quota, cancel");
  const noZone = await call(A, "POST", `/api/videos/${video.id}/jobs`, { autoDetect: false, mask: { regions: [] } });
  check("no zone and no auto -> 400", noZone.status === 400);
  const outside = await call(A, "POST", `/api/videos/${video.id}/jobs`, { autoDetect: false, mask: { regions: [{ ...det.regions[0], id: "u1", source: "user", x: 0.9, w: 0.5 }] } });
  check("zone outside the frame -> 400", outside.status === 400);
  const before = await usage(A.id, "preview");
  const j2 = await call(A, "POST", `/api/videos/${video.id}/jobs`, { autoDetect: false, mask: { regions: [{ ...det.regions[0], id: "u1", source: "user" }] }, parentJobId: job1.id });
  check("re-process -> queued, not auto", j2.status === 201 && j2.json.job.autoDetect === false);
  check("preview counted", (await usage(A.id, "preview")) === before + 1);
  check("cancel -> canceled", (await call(A, "POST", `/api/jobs/${j2.json.job.id}/cancel`)).json?.job?.status === "canceled");
  check("cancel gave the preview back", (await usage(A.id, "preview")) === before);
  check("retry canceled job", (await call(A, "POST", `/api/jobs/${j2.json.job.id}/retry`)).status === 201);
  // Everyone has the Pro limits: 100 previews a day. Jump close to the cap instead of making 100 jobs.
  await admin.from("usage_daily").update({ count: 99 }).eq("user_id", A.id).eq("kind", "preview");
  const last = await call(A, "POST", `/api/videos/${video.id}/jobs`, { autoDetect: true });
  const capHit = await call(A, "POST", `/api/videos/${video.id}/jobs`, { autoDetect: true });
  check("everyone stops at 100 previews a day", last.status === 201 && capHit.json?.error?.code === "daily_cap" && (await usage(A.id, "preview")) === 100, JSON.stringify(capHit.json));

  console.log("\nexports");
  check("4K from a 360p source -> 400 (never above the source)", (await call(A, "POST", `/api/jobs/${job1.id}/exports`, { resolution: "2160p" })).status === 400);
  check("above source (1080p from 360p) -> 400", (await call(A, "POST", `/api/jobs/${job1.id}/exports`, { resolution: "1080p" })).status === 400);
  // Exports are unlimited: 10,000 already today must not stop the next one.
  const today = new Date().toISOString().slice(0, 10);
  await admin.from("usage_daily").upsert({ user_id: A.id, usage_date: today, kind: "export", count: 10000 });
  const e1 = await call(A, "POST", `/api/jobs/${job1.id}/exports`, { resolution: "720p" });
  check("exports are unlimited (10,000 today, still allowed)", e1.status === 201 && (await usage(A.id, "export")) === 10001, JSON.stringify(e1.json));
  await admin.from("usage_daily").update({ count: 1 }).eq("user_id", A.id).eq("kind", "export");
  check("export 720p -> queued", e1.status === 201 && e1.json.export.status === "queued");
  const e2 = await call(A, "POST", `/api/jobs/${job1.id}/exports`, { resolution: "720p" });
  check("same export twice -> 409, export given back", e2.status === 409 && (await usage(A.id, "export")) === 1);

  console.log("\ncron jobs");
  check("sweep without secret -> 401", (await call(null, "GET", "/api/cron/sweep")).status === 401);
  const stuck = (await admin.from("removal_jobs").select("id").eq("video_id", video.id).eq("status", "queued").limit(1)).data[0];
  await admin.from("removal_jobs").update({ status: "rendering", heartbeat_at: new Date(Date.now() - 10 * 60_000).toISOString(), attempts: 1 }).eq("id", stuck.id);
  const sw = await call(null, "GET", "/api/cron/sweep", null, { authorization: `Bearer ${process.env.CRON_SECRET}` });
  const stuckAfter = (await admin.from("removal_jobs").select("status").eq("id", stuck.id).single()).data;
  check("sweep requeues quiet work", sw.status === 200 && sw.json.swept >= 1 && stuckAfter.status === "queued", JSON.stringify(sw.json));
  // BUG-003: after a refresh mid-clean, the new tab takes back its own work once it has been quiet for 30 s.
  const parkedJobs = (await admin.from("removal_jobs").update({ status: "canceled" }).eq("user_id", A.id).eq("status", "queued").select("id")).data.map((r) => r.id);
  const parkedExports = (await admin.from("exports").update({ status: "failed" }).eq("user_id", A.id).eq("status", "queued").select("id")).data.map((r) => r.id);
  await admin.from("removal_jobs").update({ status: "rendering", worker_ref: "tab-old-1234", heartbeat_at: new Date(Date.now() - 5_000).toISOString(), attempts: 1 }).eq("id", stuck.id);
  const busyClaim = await call(A, "POST", "/api/worker/claim", { workerId: "tab-new-1234" });
  check("claim leaves work that is still heartbeating", busyClaim.status === 200 && busyClaim.json.work?.job?.id !== stuck.id, JSON.stringify(busyClaim.json));
  await admin.from("removal_jobs").update({ heartbeat_at: new Date(Date.now() - 40_000).toISOString() }).eq("id", stuck.id);
  const reclaim = await call(A, "POST", "/api/worker/claim", { workerId: "tab-new-1234" });
  check("claim takes back own work quiet for 30 s", reclaim.status === 200 && reclaim.json.work?.job?.id === stuck.id, JSON.stringify(reclaim.json));
  const lateOld = await call(A, "POST", `/api/worker/jobs/${stuck.id}/progress`, { workerId: "tab-old-1234", progress: 50 });
  check("the old tab's late report is refused", lateOld.status === 409, String(lateOld.status));
  const crossClaim = await call(B, "POST", "/api/worker/claim", { workerId: "tab-b-12345" });
  check("another user never takes it", crossClaim.json.work == null || crossClaim.json.work.job?.id !== stuck.id);
  await admin.from("removal_jobs").update({ status: "queued", worker_ref: null, attempts: 0 }).eq("id", stuck.id);
  if (parkedJobs.length) await admin.from("removal_jobs").update({ status: "queued" }).in("id", parkedJobs);
  if (parkedExports.length) await admin.from("exports").update({ status: "queued" }).in("id", parkedExports);
  // BUG-002: an upload abandoned mid-way (tab closed or refreshed) stays "uploading" forever.
  const abandoned = (await call(A, "POST", "/api/videos", { batchId: batch.id, filename: "gone.webm", contentType: "video/webm", sizeBytes: 10, attest: true, attestationVersion: "2026-11-07" })).json.video;
  const fresh = (await call(A, "POST", "/api/videos", { batchId: batch.id, filename: "still-going.webm", contentType: "video/webm", sizeBytes: 10, attest: true, attestationVersion: "2026-11-07" })).json.video;
  await admin.from("videos").update({ created_at: new Date(Date.now() - 4 * 3600_000).toISOString() }).eq("id", abandoned.id);
  const sw2 = await call(null, "GET", "/api/cron/sweep", null, { authorization: `Bearer ${process.env.CRON_SECRET}` });
  const leftIds = (await admin.from("videos").select("id").in("id", [abandoned.id, fresh.id])).data.map((r) => r.id);
  check("sweep removes uploads abandoned for 3 h, keeps fresh ones", sw2.status === 200 && !leftIds.includes(abandoned.id) && leftIds.includes(fresh.id), JSON.stringify({ sw2: sw2.json, leftIds }));
  await call(A, "DELETE", `/api/videos/${fresh.id}`);

  console.log("\nserver worker (signed)");
  const signed = (route, body = {}, { id = "srv-test-worker", secret = process.env.WORKER_SECRET, ts = Math.floor(Date.now() / 1000), signPath = route } = {}) => {
    const raw = JSON.stringify(body);
    const sig = createHmac("sha256", secret).update(`${ts}.${id}.POST ${signPath}.${raw}`).digest("hex");
    return fetch(BASE + route, { method: "POST", headers: { "content-type": "application/json", "x-worker-id": id, "x-worker-ts": String(ts), "x-worker-sig": sig }, body: raw })
      .then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
  };
  check("unsigned claim -> 401", (await call(null, "POST", "/api/worker/server/claim", {})).status === 401);
  check("wrong secret -> 401", (await signed("/api/worker/server/claim", {}, { secret: "x".repeat(64) })).status === 401);
  check("expired signature -> 401", (await signed("/api/worker/server/claim", {}, { ts: Math.floor(Date.now() / 1000) - 900 })).status === 401);
  check("signature for another route -> 401", (await signed("/api/worker/server/claim", {}, { signPath: "/api/worker/server/other" })).status === 401);
  // The tab never takes exports while a server worker is configured.
  const tabClaims = [];
  for (let i = 0; i < 3; i++) { const c = await call(A, "POST", "/api/worker/claim", { workerId: "tab-only-previews" }); if (c.json.work) tabClaims.push(c.json.work); }
  check("tab claim skips exports in server mode", tabClaims.every((w) => w.kind === "job"), JSON.stringify(tabClaims.map((w) => w.kind)));
  for (const w of tabClaims) await admin.from("removal_jobs").update({ status: "queued", worker_ref: null }).eq("id", w.job.id);
  // Claim until A's export comes up; anything older from other runs goes back as it was.
  let mine = null; const others = [];
  for (let i = 0; i < 10 && !mine; i++) {
    const c = await signed("/api/worker/server/claim");
    if (!c.json.work) break;
    if (c.json.work.export.id === e1.json.export.id) mine = c.json.work; else others.push(c.json.work.export.id);
  }
  if (others.length) await admin.from("exports").update({ status: "queued", worker_ref: null }).in("id", others);
  check("signed claim returns the export, its mask and a source URL", !!mine && mine.sourceUrl?.startsWith("http") && Array.isArray(mine.mask?.regions) && mine.video?.height === 360, JSON.stringify(mine && { ...mine, sourceUrl: "…" }));
  if (mine) {
    const route = (a) => `/api/worker/server/exports/${mine.export.id}/${a}`;
    check("progress from the holder -> 200", (await signed(route("progress"), { progress: 40 })).status === 200);
    check("progress from another worker -> 409", (await signed(route("progress"), { progress: 41 }, { id: "srv-someone-else" })).status === 409);
    const early = await signed(route("complete"), { ok: true });
    check("complete before the file arrives -> 409", early.status === 409);
    const up = await signed(route("upload-url"));
    const put = await fetch(up.json.upload.url, { method: "PUT", headers: { "content-type": "video/mp4", "x-upsert": "true" }, body: tinyVideo });
    check("upload to the one-time URL", put.ok, String(put.status));
    const fin = await signed(route("complete"), { ok: true, durationMs: 5000 });
    const row = (await admin.from("exports").select("status, format, size_bytes").eq("id", mine.export.id).single()).data;
    check("complete -> done, stored as MP4", fin.status === 200 && row.status === "done" && row.format === "mp4" && row.size_bytes === tinyVideo.length, JSON.stringify(row));
    check("complete twice -> 409", (await signed(route("complete"), { ok: true })).status === 409);
    const file = await fetch(`${BASE}/api/files?kind=result&id=${mine.export.id}`, { headers: { authorization: `Bearer ${A.token}` }, redirect: "manual" });
    check("owner can fetch the MP4", file.status === 302 || file.status === 307, String(file.status));
  }

  console.log("\nexpiry + account deletion");
  await admin.from("videos").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", video.id);
  const ex = await call(null, "GET", "/api/cron/expire", null, { authorization: `Bearer ${process.env.CRON_SECRET}` });
  const left = await admin.storage.from("media").list(`u/${A.id}/${video.id}`);
  const vrow = (await admin.from("videos").select("status").eq("id", video.id).single()).data;
  check("expire deletes files and marks the video", ex.status === 200 && ex.json.videos >= 1 && (left.data?.length ?? 0) === 0 && vrow.status === "deleted", JSON.stringify(ex.json));
  const del = await call(A, "DELETE", "/api/account");
  const gone = await admin.auth.admin.getUserById(A.id);
  const rows = (await admin.from("batches").select("id").eq("user_id", A.id)).data;
  check("delete account removes user and rows", del.status === 200 && !gone.data?.user && rows.length === 0);
} finally {
  await admin.auth.admin.deleteUser(A.id).catch(() => {});
  await admin.auth.admin.deleteUser(B.id).catch(() => {});
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
