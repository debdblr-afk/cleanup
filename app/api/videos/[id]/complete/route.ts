import { toJob, toVideo } from "@/lib/rows";
import { body, consumeQuota, db, fail, isResponse, json, planOf, requireUser, utcToday } from "@/lib/server/http";
import { completeVideo, uuid } from "@/lib/server/schemas";
import { keys, putBytes, stat } from "@/lib/server/storage";

type VideoRow = { id: string; user_id: string; status: string; original_key: string };

// POST /api/videos/:id/complete: the upload finished. Check the stored file, apply the plan's
// length limit, save the thumbnail and queue the first (auto-detect) job.
// Duration and size come from the browser's probe for now; the GPU worker re-probes later.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  if (!uuid.safeParse(id).success) return fail(404, "not_found", "No such video.");
  const input = await body(req, completeVideo);
  if (isResponse(input)) return input;

  const { data: v } = await db().from("videos").select("id, user_id, status, original_key").eq("id", id).single<VideoRow>();
  if (!v || v.user_id !== user.id) return fail(404, "not_found", "No such video.");
  if (v.status !== "uploading") return fail(409, "already_done", "This upload was already completed.");

  const plan = await planOf(user.id);
  const file = await stat(v.original_key);
  if (!file) return fail(409, "missing_upload", "The file didn't arrive. Try uploading it again.");

  let thumbnailKey: string | null = null;
  if (input.thumbnail) {
    const bytes = Buffer.from(input.thumbnail.slice(input.thumbnail.indexOf(",") + 1), "base64");
    thumbnailKey = keys.thumb(user.id, id);
    await putBytes(thumbnailKey, bytes, "image/jpeg");
  }

  const reject = file.size > plan.maxBytes ? "too_large" : input.durationMs > plan.maxDurationMs ? "too_long" : null;
  const { data: updated } = await db().from("videos").update({
    status: reject ? "rejected" : "ready", reject_reason: reject, size_bytes: file.size,
    duration_ms: input.durationMs, width: input.width, height: input.height, thumbnail_key: thumbnailKey,
  } as never).eq("id", id).eq("status", "uploading").select().single();
  if (!updated) return fail(409, "already_done", "This upload was already completed.");

  let job = null;
  if (!reject && (await consumeQuota(user.id, "preview", plan.previewsPerDay))) {
    const { data } = await db().from("removal_jobs").insert({ user_id: user.id, video_id: id, auto_detect: true, quota_date: utcToday() } as never).select().single();
    job = data ? toJob(data) : null;
  }
  return json({ video: toVideo(updated), job });
}
