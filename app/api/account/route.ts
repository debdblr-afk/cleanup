import { db, fail, isResponse, json, requireUser } from "@/lib/server/http";
import { keys, removePrefix } from "@/lib/server/storage";

// DELETE /api/account: delete every file, then the auth user (rows cascade).
export async function DELETE() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  await removePrefix(keys.prefix(user.id));
  const { error } = await db().auth.admin.deleteUser(user.id);
  if (error) return fail(500, "delete_failed", "Couldn't delete the account.");
  return json({ ok: true });
}
