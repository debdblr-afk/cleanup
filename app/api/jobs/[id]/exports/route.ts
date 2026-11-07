import { RESOLUTIONS, resolutionAllowed } from "@/lib/plans";
import { toExport } from "@/lib/rows";
import { body, consumeQuota, db, fail, hoursUntilReset, isResponse, json, planOf, refundQuota, requireUser, utcToday } from "@/lib/server/http";
import { createExport, uuid } from "@/lib/server/schemas";

// POST /api/jobs/:id/exports: full-length render at a plan resolution (takes one export).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  if (!uuid.safeParse(id).success) return fail(404, "not_found", "No such job.");
  const input = await body(req, createExport);
  if (isResponse(input)) return input;

  const { data: j } = await db().from("removal_jobs").select("user_id, status, videos(height)").eq("id", id).single<{ user_id: string; status: string; videos: { height: number | null } | null }>();
  if (!j || j.user_id !== user.id) return fail(404, "not_found", "No such job.");
  if (j.status !== "done") return fail(409, "not_ready", "The preview isn't ready yet.");

  const plan = await planOf(user.id);
  if (!resolutionAllowed(plan, input.resolution)) return fail(402, "upgrade", "That resolution isn't on your plan.");
  const res = RESOLUTIONS.find((r) => r.id === input.resolution)!;
  if (j.videos?.height && res.height > Math.max(720, j.videos.height)) return fail(400, "above_source", "That's bigger than the original video.");

  const today = utcToday();
  if (!(await consumeQuota(user.id, "export", plan.exportsPerDay))) return fail(429, "daily_cap", "No exports left today.", { resetsInHours: hoursUntilReset() });
  const { data, error } = await db().from("exports").insert({ user_id: user.id, job_id: id, resolution: input.resolution, quota_date: today } as never).select().single();
  if (error?.code === "23505") {
    await refundQuota(user.id, "export", today);
    return fail(409, "busy", "That export is already running or done.");
  }
  if (error || !data) {
    await refundQuota(user.id, "export", today);
    return fail(500, "db", "Couldn't queue the export.");
  }
  return json({ export: toExport(data) }, 201);
}
