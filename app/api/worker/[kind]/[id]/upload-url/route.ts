import { body, fail, isResponse, json, requireUser } from "@/lib/server/http";
import { uuid, workerUpload } from "@/lib/server/schemas";
import { keys, signedUpload } from "@/lib/server/storage";
import { heldWork, videoIdFor, type WorkKind } from "@/lib/server/worker";

// POST /api/worker/:kind/:id/upload-url: one-time URL for the rendered file.
export async function POST(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { kind, id } = await params;
  if ((kind !== "jobs" && kind !== "exports") || !uuid.safeParse(id).success) return fail(404, "not_found", "No such work.");
  const input = await body(req, workerUpload);
  if (isResponse(input)) return input;
  const row = await heldWork(kind as WorkKind, id, user.id, input.workerId);
  if (!row) return fail(409, "not_held", "This work was canceled or moved to another worker.");
  const videoId = await videoIdFor(kind as WorkKind, row);
  if (!videoId) return fail(404, "not_found", "No such video.");
  const path = kind === "jobs" ? keys.preview(user.id, videoId, id) : keys.result(user.id, videoId, id);
  const { path: p, token } = await signedUpload(path);
  return json({ upload: { path: p, token } });
}
