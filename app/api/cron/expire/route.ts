import { db, fail, json } from "@/lib/server/http";
import { cronAuthorized } from "@/lib/server/cron";
import { keys, removePrefix } from "@/lib/server/storage";

// GET /api/cron/expire (hourly): delete files and cards past their plan's retention, then empty batches.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return fail(401, "unauthorized", "Bad cron secret.");
  const now = new Date().toISOString();
  const { data: vids } = await db().from("videos").select("id, user_id").lt("expires_at", now).neq("status", "deleted").limit(500);
  let files = 0, failed = 0;
  for (const v of (vids ?? []) as { id: string; user_id: string }[]) {
    try {
      files += await removePrefix(keys.prefix(v.user_id, v.id));
      await db().from("videos").update({ status: "deleted" } as never).eq("id", v.id);
    } catch {
      failed++; // stays for the next run; logged count only
    }
  }
  const { data: gone } = await db().from("batches").delete().lt("expires_at", now).select("id");
  if (failed) console.error(`[cron/expire] ${failed} videos failed to delete; will retry`);
  return json({ videos: (vids?.length ?? 0) - failed, files, batches: gone?.length ?? 0, failed });
}
