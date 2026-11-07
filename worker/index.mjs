// Server worker: renders full-length exports with ffmpeg (MP4, H.264 + AAC audio) so the
// browser tab doesn't have to. It claims work from the app over signed HTTP (no database
// keys here), downloads the original, runs the filters from plan.mjs, uploads the result
// with a one-time URL, and reports back.
//
//   npm run worker        (reads .env.local: APP_URL, WORKER_SECRET)
//
// Runs anywhere Node 22 runs (a small VM, Fly, Render, a GPU box later). Several can run at
// once: the database hands each export to one worker. GET http://localhost:$WORKER_HEALTH_PORT
// answers {"ok":true,...} for health checks.

import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import ffmpegStatic from "ffmpeg-static";
import { buildFilter, parseProbe } from "./plan.mjs";

const APP_URL = (process.env.APP_URL ?? "http://localhost:5320").replace(/\/$/, "");
const SECRET = process.env.WORKER_SECRET ?? "";
const WORKER_ID = (process.env.WORKER_ID ?? `srv-${hostname()}-${process.pid}`).replace(/[^\w.-]/g, "-").slice(0, 64);
const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic;
const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT ?? 5399);
const IDLE_MS = 3000;
const HEIGHTS = { "720p": 720, "1080p": 1080, "1440p": 1440, "2160p": 2160 };

if (SECRET.length < 32) {
  console.error("WORKER_SECRET is missing or shorter than 32 characters. Set the same value in the app and here.");
  process.exit(1);
}

const state = { busy: null, done: 0, failed: 0, lastError: null, startedAt: new Date().toISOString() };
const log = (...a) => console.log(new Date().toISOString(), ...a);

/** Signed POST to the app. Throws with .status on a non-2xx answer. */
async function call(route, body = {}) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", SECRET).update(`${ts}.${WORKER_ID}.POST ${route}.${raw}`).digest("hex");
  const res = await fetch(`${APP_URL}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-worker-id": WORKER_ID, "x-worker-ts": ts, "x-worker-sig": sig },
    body: raw,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error?.message ?? `HTTP ${res.status}`), { status: res.status, code: data?.error?.code });
  return data;
}

function run(args, { cwd, onStdout } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stdout.on("data", (d) => onStdout?.(d.toString()));
    p.stderr.on("data", (d) => { err = (err + d.toString()).slice(-20_000); });
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, stderr: err, proc: p }));
    run.current = p;
  });
}

async function render(work) {
  const ex = work.export;
  const dir = await mkdtemp(path.join(tmpdir(), "cleanup-"));
  let canceled = false;
  try {
    // 1. The original, streamed to disk.
    const src = path.join(dir, "source");
    const res = await fetch(work.sourceUrl);
    if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(src));

    // 2. Probe it here rather than trusting what the browser reported.
    const probe = parseProbe((await run(["-hide_banner", "-i", src])).stderr);
    const W = probe.width ?? work.video.width, H = probe.height ?? work.video.height;
    if (!W || !H) throw new Error("couldn't read the video's size");
    const durationMs = probe.durationMs ?? work.video.durationMs ?? null;

    // 3. Filters, plus a mask image for each group of brush strokes.
    const { graph, masks } = buildFilter(work.mask, W, H, HEIGHTS[ex.resolution] ?? 720);
    for (const m of masks) await writeFile(path.join(dir, m.name), m.data);

    // 4. Render, reporting progress (which is also the heartbeat) every 2 s.
    const out = path.join(dir, "out.mp4");
    let pct = 0, last = 0;
    const tick = async () => {
      if (Date.now() - last < 2000) return;
      last = Date.now();
      try { await call(`/api/worker/server/exports/${ex.id}/progress`, { progress: pct }); }
      catch (e) { if (e.status === 409) { canceled = true; run.current?.kill("SIGKILL"); } }
    };
    const beat = setInterval(tick, 2000);
    const { code, stderr } = await run([
      "-hide_banner", "-y", "-i", src,
      "-filter_complex", graph, "-map", "[out]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
      "-progress", "pipe:1", "-nostats", out,
    ], {
      cwd: dir,
      onStdout: (text) => {
        const m = text.match(/out_time_us=(\d+)/g);
        if (m && durationMs) pct = Math.min(99, Math.floor((Number(m[m.length - 1].split("=")[1]) / 1000 / durationMs) * 100));
      },
    });
    clearInterval(beat);
    if (canceled) { log(`export ${ex.id} canceled`); return; }
    if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${stderr.split("\n").filter(Boolean).slice(-3).join(" | ")}`);

    // 5. Upload with the one-time URL, then report done.
    const { upload } = await call(`/api/worker/server/exports/${ex.id}/upload-url`);
    const size = (await stat(out)).size;
    const put = await fetch(upload.url, {
      method: "PUT",
      headers: { "content-type": "video/mp4", "content-length": String(size), "x-upsert": "true" },
      body: Readable.toWeb(createReadStream(out)),
      duplex: "half",
    });
    if (!put.ok) throw new Error(`upload failed (${put.status}): ${(await put.text()).slice(0, 200)}`);
    await call(`/api/worker/server/exports/${ex.id}/complete`, { ok: true, ...(durationMs ? { durationMs } : {}) });
    state.done++;
    log(`export ${ex.id} done: ${ex.resolution}, ${(size / 1e6).toFixed(1)} MB`);
  } catch (e) {
    state.failed++;
    state.lastError = String(e.message ?? e);
    log(`export ${ex.id} failed: ${state.lastError}`);
    if (!canceled) await call(`/api/worker/server/exports/${ex.id}/complete`, { ok: false, error: state.lastError.slice(0, 300) }).catch(() => {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

let stopping = false;
async function loop() {
  log(`worker ${WORKER_ID} polling ${APP_URL}`);
  while (!stopping) {
    try {
      const { work } = await call("/api/worker/server/claim");
      if (!work) { await new Promise((r) => setTimeout(r, IDLE_MS)); continue; }
      state.busy = work.export.id;
      log(`export ${work.export.id} claimed (${work.export.resolution})`);
      await render(work);
    } catch (e) {
      state.lastError = String(e.message ?? e);
      log(`claim failed: ${state.lastError}`);
      await new Promise((r) => setTimeout(r, IDLE_MS * 3));
    } finally {
      state.busy = null;
    }
  }
}

createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, worker: WORKER_ID, ...state }));
}).listen(HEALTH_PORT, () => log(`health on :${HEALTH_PORT}`));

// On shutdown, stop ffmpeg and exit; the export goes back in the queue after a minute of silence.
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopping = true; run.current?.kill("SIGKILL"); process.exit(0); });

void loop();
