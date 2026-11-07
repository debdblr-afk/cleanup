import { toJob } from "@/lib/rows";
import { consumeQuota, db, fail, hoursUntilReset, isResponse, json, planOf, requireUser, utcToday } from "@/lib/server/http";
import { uuid } from "@/lib/server/schemas";

type JobRow = { user_id: string; video_id: string; parent_job_id: string | null; mode: string; auto_detect: boolean; mask: unknown; status: string };

// POST /api/jobs/:id/retry: same zones, new job (takes one preview).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  if (!uuid.safeParse(id).success) return fail(404, "not_found", "No such job.");
  const { data: j } = await db().from("removal_jobs").select("user_id, video_id, parent_job_id, mode, auto_detect, mask, status").eq("id", id).single<JobRow>();
  if (!j || j.user_id !== user.id) return fail(404, "not_found", "No such job.");
  if (!["failed", "canceled"].includes(j.status)) return fail(409, "not_finished", "Only failed or canceled jobs can be retried.");
  const plan = await planOf(user.id);
  if (!(await consumeQuota(user.id, "preview", plan.previewsPerDay))) return fail(429, "daily_cap", "No previews left today.", { resetsInHours: hoursUntilReset() });
  const { data } = await db().from("removal_jobs").insert({
    user_id: user.id, video_id: j.video_id, parent_job_id: j.parent_job_id, mode: j.mode, auto_detect: j.auto_detect, mask: j.mask, quota_date: utcToday(),
  } as never).select().single();
  return json({ job: data ? toJob(data) : null }, 201);
}
