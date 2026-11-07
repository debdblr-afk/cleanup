import { db, fail, json } from "@/lib/server/http";
import { cronAuthorized } from "@/lib/server/cron";
import { keys, removePrefix } from "@/lib/server/storage";

// Signed upload tokens last 2 hours, so an upload still "uploading" after 3 hours never finished
// (the tab was closed or refreshed mid-upload). No quota is used before an upload completes.
const ABANDONED_AFTER_MS = 3 * 3600_000;

// GET /api/cron/sweep (every 5 min): work whose worker went quiet goes back in the queue, or fails
// after 3 tries; uploads that were abandoned half way are removed.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return fail(401, "unauthorized", "Bad cron secret.");
  const { data, error } = await db().rpc("sweep_stuck", {} as never);
  if (error) return fail(500, "db", "Sweep failed.");

  const cutoff = new Date(Date.now() - ABANDONED_AFTER_MS).toISOString();
  const { data: stale } = await db().from("videos").select("id, user_id").eq("status", "uploading").lt("created_at", cutoff).limit(200);
  let abandoned = 0;
  for (const v of (stale ?? []) as { id: string; user_id: string }[]) {
    try {
      await removePrefix(keys.prefix(v.user_id, v.id));
      await db().from("videos").delete().eq("id", v.id).eq("status", "uploading");
      abandoned++;
    } catch {
      // stays for the next run
    }
  }
  return json({ swept: (data as number) + abandoned, abandoned });
}
