import { db, fail, json } from "@/lib/server/http";
import { cronAuthorized } from "@/lib/server/cron";
import { keys, removePrefix } from "@/lib/server/storage";
import { RETENTION_DAYS } from "@/lib/plans";

// GET /api/cron/expire (daily, vercel.json): delete the files and cards of every video that is past
// its stored expiry OR was uploaded longer ago than today's retention (RETENTION_DAYS), then the
// batches they belonged to. Judging by upload time too means a shorter retention applies to old videos.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return fail(401, "unauthorized", "Bad cron secret.");
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const { data: vids } = await db().from("videos").select("id, user_id").or(`expires_at.lt.${now},created_at.lt.${cutoff}`).neq("status", "deleted").limit(500);
  let files = 0, failed = 0;
  for (const v of (vids ?? []) as { id: string; user_id: string }[]) {
    try {
      files += await removePrefix(keys.prefix(v.user_id, v.id));
      await db().from("videos").update({ status: "deleted" } as never).eq("id", v.id);
    } catch {
      failed++; // stays for the next run; logged count only
    }
  }
  // Batches go once their videos have; if any video failed to delete, keep batches for the next run
  // so their files aren't orphaned.
  const { data: gone } = failed ? { data: [] } : await db().from("batches").delete().or(`expires_at.lt.${now},created_at.lt.${cutoff}`).select("id");
  if (failed) console.error(`[cron/expire] ${failed} videos failed to delete; will retry`);
  return json({ videos: (vids?.length ?? 0) - failed, files, batches: gone?.length ?? 0, failed });
}
