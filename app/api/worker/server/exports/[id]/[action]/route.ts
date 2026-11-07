import { z } from "zod";
import { db, fail, isResponse, json, refundQuota } from "@/lib/server/http";
import { uuid } from "@/lib/server/schemas";
import { keys, signedUpload, stat } from "@/lib/server/storage";
import { heldWork, videoIdFor } from "@/lib/server/worker";
import { workerRequest } from "@/lib/server/worker-auth";

const progress = z.object({ progress: z.number().int().min(0).max(100) });
const complete = z.object({ ok: z.boolean(), durationMs: z.number().int().positive().optional(), error: z.string().max(300).optional() });

// POST /api/worker/server/exports/:id/(progress|upload-url|complete) (signed).
// Same rules as the tab's routes, except the worker may hold anyone's export.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  if (!uuid.safeParse(id).success || !["progress", "upload-url", "complete"].includes(action)) return fail(404, "not_found", "No such work.");
  const schema = action === "progress" ? progress : action === "complete" ? complete : z.object({}).passthrough();
  const auth = await workerRequest(req, schema as z.ZodType<Record<string, unknown>>);
  if (isResponse(auth)) return auth;
  const row = await heldWork("exports", id, null, auth.workerId);
  if (!row) return fail(409, "not_held", "This export was canceled or moved to another worker.");
  const videoId = await videoIdFor("exports", row);
  if (!videoId) return fail(404, "not_found", "No such video.");
  const path = keys.result(row.user_id, videoId, id);

  if (action === "progress") {
    const p = auth.input as z.infer<typeof progress>;
    await db().from("exports").update({ progress: p.progress, heartbeat_at: new Date().toISOString() } as never).eq("id", id).eq("worker_ref", auth.workerId);
    return json({ ok: true });
  }
  if (action === "upload-url") {
    return json({ upload: await signedUpload(path, "video/mp4") });
  }

  const c = auth.input as z.infer<typeof complete>;
  const now = new Date().toISOString();
  if (c.ok) {
    const file = await stat(path);
    if (!file || !file.size) return fail(409, "missing_output", "The rendered file didn't arrive.");
    await db().from("exports").update({
      status: "done", progress: 100, result_key: path, size_bytes: file.size, finished_at: now,
      format: file.type.includes("mp4") ? "mp4" : "webm",
    } as never).eq("id", id).eq("worker_ref", auth.workerId);
    return json({ ok: true });
  }
  const { data } = await db().from("exports").update({ status: "failed", error_message: "The export stopped partway. Your export was given back.", finished_at: now } as never)
    .eq("id", id).eq("worker_ref", auth.workerId).eq("status", "rendering").select("id");
  if (data?.length) await refundQuota(row.user_id, "export", row.quota_date);
  return json({ ok: true });
}
