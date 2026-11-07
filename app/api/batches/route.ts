import { toBatch } from "@/lib/rows";
import { db, fail, isResponse, json, planOf, requireUser } from "@/lib/server/http";

// POST /api/batches: a new batch, kept for the plan's retention period.
export async function POST() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const plan = await planOf(user.id);
  const expiresAt = new Date(Date.now() + plan.retentionDays * 86_400_000).toISOString();
  const { data, error } = await db().from("batches").insert({ user_id: user.id, expires_at: expiresAt } as never).select().single();
  if (error || !data) return fail(500, "db", "Couldn't create the batch.");
  return json({ batch: toBatch(data) }, 201);
}
