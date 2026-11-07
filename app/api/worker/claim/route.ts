import { toExport, toJob } from "@/lib/rows";
import { body, db, isResponse, json, requireUser } from "@/lib/server/http";
import { z } from "zod";

// POST /api/worker/claim: the next queued preview (or export) for this user, if any.
// The browser engine is the worker for now; a GPU worker will claim with its own credentials.
export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const input = await body(req, z.object({ workerId: z.string().min(8).max(64) }));
  if (isResponse(input)) return input;
  const { data, error } = await db().rpc("claim_work", { p_user: user.id, p_worker: input.workerId } as never);
  if (error) return json({ work: null });
  const w = data as { kind: "job" | "export"; row: Record<string, unknown> } | null;
  if (!w) return json({ work: null });
  return json({ work: w.kind === "job" ? { kind: "job", job: toJob(w.row) } : { kind: "export", export: toExport(w.row) } });
}
