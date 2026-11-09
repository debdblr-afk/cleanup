import { body, db, fail, isResponse, json, refundQuota, requireUser } from "@/lib/server/http";
import { uuid, workerComplete } from "@/lib/server/schemas";
import { keys, stat } from "@/lib/server/storage";
import { heldWork, videoIdFor, type WorkKind } from "@/lib/server/worker";

const MESSAGES = {
  nothing_found: "We couldn't find a watermark. Mark it yourself and clean again.",
  render_failed: "The cleaner stopped partway. Your preview was given back.",
  unsupported_browser: "This browser can't record video. Try Chrome, Edge or Firefox.",
};

// POST /api/worker/:kind/:id/complete: finished (file must be in storage) or failed (quota given back).
// Conditional on the worker still holding the item, so repeats and late arrivals change nothing.
export async function POST(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { kind, id } = await params;
  if ((kind !== "jobs" && kind !== "exports") || !uuid.safeParse(id).success) return fail(404, "not_found", "No such work.");
  const input = await body(req, workerComplete);
  if (isResponse(input)) return input;
  const k = kind as WorkKind;
  const row = await heldWork(k, id, user.id, input.workerId);
  if (!row) return fail(409, "not_held", "This work was canceled or moved to another worker.");
  const table = k === "jobs" ? "removal_jobs" : "exports";
  const now = new Date().toISOString();

  if (input.ok) {
    const videoId = await videoIdFor(k, row);
    const path = videoId && (k === "jobs" ? keys.preview(user.id, videoId, id) : keys.result(user.id, videoId, id));
    const file = path ? await stat(path) : null;
    if (!file || !file.size) return fail(409, "missing_output", "The rendered file didn't arrive.");
    const patch = k === "jobs"
      ? { status: "done", progress: 100, preview_key: path, preview_ms: input.durationMs ?? null, finished_at: now, ...(input.detectedMask !== undefined ? { detected_mask: input.detectedMask } : {}) }
      : { status: "done", progress: 100, result_key: path, size_bytes: file.size, finished_at: now, format: file.type.includes("mp4") ? "mp4" : "webm" };
    await db().from(table).update(patch as never).eq("id", id).eq("worker_ref", input.workerId);
    return json({ ok: true });
  }

  const code = input.errorCode ?? "render_failed";
  const patch = k === "jobs"
    ? { status: "failed", error_code: code, error_message: MESSAGES[code], finished_at: now, ...(input.detectedMask !== undefined ? { detected_mask: input.detectedMask } : {}) }
    : { status: "failed", error_message: "The export stopped partway. Your export was given back.", finished_at: now };
  const { data } = await db().from(table).update(patch as never).eq("id", id).eq("worker_ref", input.workerId).in("status", k === "jobs" ? ["detecting", "rendering"] : ["rendering"]).select("id");
  if (data?.length) await refundQuota(user.id, k === "jobs" ? "preview" : "export", row.quota_date);
  return json({ ok: true });
}
