import { hasErase } from "@/lib/mask";
import { toJob } from "@/lib/rows";
import { body, consumeQuota, db, fail, hoursUntilReset, isResponse, json, planOf, requireUser, utcToday } from "@/lib/server/http";
import { createJob, uuid } from "@/lib/server/schemas";

// POST /api/videos/:id/jobs: clean again with the user's zones (takes one preview).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  if (!uuid.safeParse(id).success) return fail(404, "not_found", "No such video.");
  const input = await body(req, createJob);
  if (isResponse(input)) return input;

  const { data: v } = await db().from("videos").select("id, user_id, status").eq("id", id).single<{ id: string; user_id: string; status: string }>();
  if (!v || v.user_id !== user.id || v.status === "deleted") return fail(404, "not_found", "No such video.");
  if (v.status !== "ready") return fail(409, "not_ready", "This video isn't ready yet.");
  if (input.parentJobId) {
    const { data: p } = await db().from("removal_jobs").select("video_id").eq("id", input.parentJobId).single<{ video_id: string }>();
    if (!p || p.video_id !== id) return fail(400, "invalid", "That version belongs to another video.");
  }
  const autoDetect = input.autoDetect && !hasErase(input.mask);
  if (!autoDetect && !hasErase(input.mask)) return fail(400, "invalid", "Draw at least one erase zone or turn on automatic detection.");

  const plan = await planOf(user.id);
  if (!(await consumeQuota(user.id, "preview", plan.previewsPerDay)))
    return fail(429, "daily_cap", "No previews left today.", { resetsInHours: hoursUntilReset() });

  const { data, error } = await db().from("removal_jobs").insert({
    user_id: user.id, video_id: id, parent_job_id: input.parentJobId, mode: input.mode, auto_detect: autoDetect, mask: input.mask, quota_date: utcToday(),
  } as never).select().single();
  if (error || !data) return fail(500, "db", "Couldn't queue the job.");
  return json({ job: toJob(data) }, 201);
}
