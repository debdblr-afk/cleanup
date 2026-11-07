import { z } from "zod";
import { isMask, mergeMasks } from "@/lib/mask";
import { toExport } from "@/lib/rows";
import { db, fail, isResponse, json } from "@/lib/server/http";
import { keys, signedRead } from "@/lib/server/storage";
import { workerRequest } from "@/lib/server/worker-auth";
import type { Mask } from "@/lib/types";

// POST /api/worker/server/claim (signed): the next export to render, from any user, with what
// the worker needs: the effective mask, the source's recorded size, and a 1-hour read URL.
export async function POST(req: Request) {
  const auth = await workerRequest(req, z.object({}).passthrough());
  if (isResponse(auth)) return auth;
  const { data, error } = await db().rpc("claim_export_any", { p_worker: auth.workerId } as never);
  if (error) return fail(500, "db", "Claim failed.");
  const row = data as Record<string, unknown> | null;
  if (!row?.id) return json({ work: null });
  const { data: job } = await db().from("removal_jobs").select("video_id, mask, detected_mask").eq("id", String(row.job_id)).single<{ video_id: string; mask: unknown; detected_mask: unknown }>();
  const { data: video } = job ? await db().from("videos").select("id, user_id, width, height, duration_ms").eq("id", job.video_id).single<{ id: string; user_id: string; width: number | null; height: number | null; duration_ms: number | null }>() : { data: null };
  if (!job || !video) {
    await db().from("exports").update({ status: "failed", error_message: "The video for this export is gone." } as never).eq("id", String(row.id)).eq("worker_ref", auth.workerId);
    return json({ work: null });
  }
  const mask = mergeMasks(isMask(job.mask) ? job.mask : { regions: [] }, isMask(job.detected_mask) ? (job.detected_mask as Mask) : null);
  return json({
    work: {
      export: toExport(row),
      mask,
      video: { width: video.width, height: video.height, durationMs: video.duration_ms },
      sourceUrl: await signedRead(keys.original(video.user_id, video.id), 3600),
    },
  });
}
