import { db, fail, isResponse, json, requireUser } from "@/lib/server/http";
import { stripe, stripeEnabled } from "@/lib/server/billing";
import { keys, removePrefix } from "@/lib/server/storage";

// DELETE /api/account: cancel billing, delete every file, delete the auth user (rows cascade).
export async function DELETE() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { data: subs } = await db().from("subscriptions").select("stripe_subscription_id, status").eq("user_id", user.id);
  const live = ((subs ?? []) as { stripe_subscription_id: string; status: string }[]).filter((s) => !["canceled", "incomplete_expired"].includes(s.status));
  if (live.length && !stripeEnabled()) return fail(503, "payments_off", "Can't cancel your subscription right now. Try again later.");
  for (const s of live) await stripe().subscriptions.cancel(s.stripe_subscription_id);
  await removePrefix(keys.prefix(user.id));
  const { error } = await db().auth.admin.deleteUser(user.id);
  if (error) return fail(500, "delete_failed", "Couldn't delete the account.");
  return json({ ok: true });
}
