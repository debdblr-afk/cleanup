import { db, fail, json } from "@/lib/server/http";
import { cronAuthorized } from "@/lib/server/cron";

// GET /api/cron/sweep (every 5 min): work whose worker went quiet goes back in the queue, or fails after 3 tries.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return fail(401, "unauthorized", "Bad cron secret.");
  const { data, error } = await db().rpc("sweep_stuck", {} as never);
  if (error) return fail(500, "db", "Sweep failed.");
  return json({ swept: data });
}
