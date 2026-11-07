import { db, fail, isResponse, json, refundQuota, requireUser } from "@/lib/server/http";
import { uuid } from "@/lib/server/schemas";
import { keys, removePrefix } from "@/lib/server/storage";

// DELETE /api/videos/:id: remove the card, stop its work, delete its files.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await params;
  if (!uuid.safeParse(id).success) return fail(404, "not_found", "No such video.");
  const { data: v } = await db().from("videos").select("id, user_id").eq("id", id).single<{ id: string; user_id: string }>();
  if (!v || v.user_id !== user.id) return fail(404, "not_found", "No such video.");

  const { data: stopped } = await db().from("removal_jobs").update({ status: "canceled", finished_at: new Date().toISOString() } as never)
    .eq("video_id", id).in("status", ["queued", "detecting", "rendering"]).select("quota_date");
  for (const j of (stopped ?? []) as { quota_date: string }[]) await refundQuota(user.id, "preview", j.quota_date);
  await db().from("videos").update({ status: "deleted" } as never).eq("id", id);
  await removePrefix(keys.prefix(user.id, id));
  return json({ ok: true });
}
