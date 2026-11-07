import { toJob } from "@/lib/rows";
import { db, fail, isResponse, json, refundQuota, requireUser } from "@/lib/server/http";
import { uuid } from "@/lib/server/schemas";

// POST /api/jobs/:id/cancel: stop a queued or running job and give the preview back.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  if (!uuid.safeParse(id).success) return fail(404, "not_found", "No such job.");
  const { data } = await db().from("removal_jobs").update({ status: "canceled", finished_at: new Date().toISOString() } as never)
    .eq("id", id).eq("user_id", user.id).in("status", ["queued", "detecting", "rendering"]).select().single<{ quota_date: string }>();
  if (!data) return fail(409, "not_running", "That job already finished or isn't yours.");
  await refundQuota(user.id, "preview", data.quota_date);
  return json({ job: toJob(data as never) });
}
