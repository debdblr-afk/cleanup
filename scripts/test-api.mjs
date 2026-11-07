// End-to-end API + access-rule test against the local stack and a running dev server.
//   node --env-file=.env.local scripts/test-api.mjs            (BASE defaults to http://localhost:5320)
// Creates two throwaway users with random passwords, exercises every route, checks that
// user B can see or touch nothing of user A's, then deletes both users.
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { randomBytes, randomUUID } from "node:crypto";

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
  let capHit = null;
  for (let i = 0; i < 10 && !capHit; i++) {
    const r = await call(A, "POST", `/api/videos/${video.id}/jobs`, { autoDetect: true });
    if (r.status === 429) capHit = r;
  }
  check("free plan stops at 5 previews a day", capHit?.json?.error?.code === "daily_cap" && (await usage(A.id, "preview")) === 5);

  console.log("\nexports");
  check("free plan -> 402 upgrade", (await call(A, "POST", `/api/jobs/${job1.id}/exports`, { resolution: "720p" })).status === 402);
  await admin.from("profiles").update({ plan: "plus" }).eq("id", A.id);
  check("above plan (4K on Plus) -> 402", (await call(A, "POST", `/api/jobs/${job1.id}/exports`, { resolution: "2160p" })).status === 402);
  check("above source (1080p from 360p) -> 400", (await call(A, "POST", `/api/jobs/${job1.id}/exports`, { resolution: "1080p" })).status === 400);
  const e1 = await call(A, "POST", `/api/jobs/${job1.id}/exports`, { resolution: "720p" });
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

  console.log("\nstripe webhook");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = new Stripe("unused");
  const now = Math.floor(Date.now() / 1000);
  const sub = (status, extra = {}) => ({
    id: "sub_test_" + A.id.slice(0, 8), object: "subscription", customer: "cus_test_" + A.id.slice(0, 8), status, cancel_at_period_end: false,
    metadata: { user_id: A.id },
    items: { object: "list", data: [{ id: "si_1", current_period_end: now + 30 * 86400, price: { id: process.env.STRIPE_PRICE_PRO_MONTH, unit_amount: 3200, currency: "usd", recurring: { interval: "month" } } }] },
    ...extra,
  });
  const send = async (event, sig) => {
    const payload = JSON.stringify(event);
    const header = sig ?? stripe.webhooks.generateTestHeaderString({ payload, secret });
    return fetch(BASE + "/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": header, "content-type": "application/json" }, body: payload })
      .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  };
  const plan = async () => (await admin.from("profiles").select("plan").eq("id", A.id).single()).data.plan;
  const evt = (id, type, created, obj) => ({ id, object: "event", type, created, data: { object: obj }, livemode: false, api_version: "2025-01-01" });
  check("bad signature -> 400", (await send(evt("evt_bad", "customer.subscription.created", now, sub("active")), "t=1,v1=deadbeef")).status === 400);
  const created = evt(`evt_${randomUUID()}`, "customer.subscription.created", now, sub("active"));
  const r1 = await send(created);
  check("subscription.created -> Pro", r1.status === 200 && r1.json.outcome === "applied" && (await plan()) === "pro", JSON.stringify(r1.json));
  check("same event again -> duplicate, no change", (await send(created)).json?.duplicate === true);
  const old = await send(evt(`evt_${randomUUID()}`, "customer.subscription.updated", now - 300, sub("canceled")));
  check("older event out of order -> ignored", old.json?.outcome === "stale" && (await plan()) === "pro");
  const pastDue = await send(evt(`evt_${randomUUID()}`, "customer.subscription.updated", now + 10, sub("past_due")));
  check("past_due keeps the plan during retries", pastDue.json?.outcome === "applied" && (await plan()) === "pro");
  await send(evt(`evt_${randomUUID()}`, "customer.subscription.deleted", now + 20, sub("canceled")));
  check("subscription.deleted -> back to Free", (await plan()) === "free");
  const cs = await send(evt(`evt_${randomUUID()}`, "checkout.session.completed", now + 30, { id: "cs_1", object: "checkout.session", client_reference_id: B.id, customer: "cus_bob" }));
  const bCust = (await admin.from("profiles").select("stripe_customer_id").eq("id", B.id).single()).data.stripe_customer_id;
  check("checkout.session.completed links the customer", cs.json?.outcome === "linked" && bCust === "cus_bob");
  check("checkout without Stripe key -> 503", (await call(A, "POST", "/api/billing/checkout", { plan: "plus", interval: "month" })).status === 503);

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
