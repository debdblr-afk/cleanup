import { body, db, fail, isResponse, json, requireUser } from "@/lib/server/http";
import { uuid, workerProgress } from "@/lib/server/schemas";
import { heldWork, type WorkKind } from "@/lib/server/worker";

// POST /api/worker/:kind/:id/progress: heartbeat + progress; detecting -> rendering with what was found.
export async function POST(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { kind, id } = await params;
  if ((kind !== "jobs" && kind !== "exports") || !uuid.safeParse(id).success) return fail(404, "not_found", "No such work.");
  const input = await body(req, workerProgress);
  if (isResponse(input)) return input;
  const row = await heldWork(kind as WorkKind, id, user.id, input.workerId);
  if (!row) return fail(409, "not_held", "This work was canceled or moved to another worker.");

  const patch: Record<string, unknown> = { progress: input.progress, heartbeat_at: new Date().toISOString() };
  if (kind === "jobs" && input.status) patch.status = input.status;
  if (kind === "jobs" && input.detectedMask !== undefined) patch.detected_mask = input.detectedMask;
  await db().from(kind === "jobs" ? "removal_jobs" : "exports").update(patch as never).eq("id", id).eq("worker_ref", input.workerId);
  return json({ ok: true });
}
