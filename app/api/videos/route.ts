import { toVideo } from "@/lib/rows";
import { body, db, fail, isResponse, json, planOf, requireUser } from "@/lib/server/http";
import { createVideo } from "@/lib/server/schemas";
import { keys, signedUpload } from "@/lib/server/storage";
import { formatBytes } from "@/lib/format";
import { ASK_RIGHTS, RIGHTS_NOT_ASKED } from "@/lib/plans";

// POST /api/videos: check the file against the plan, record it, hand back a one-time upload URL.
export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const input = await body(req, createVideo);
  if (isResponse(input)) return input;
  if (ASK_RIGHTS && !input.attest) return fail(400, "no_attestation", "Confirm you have the rights to this video first.");

  const { data: batch } = await db().from("batches").select("id, user_id, expires_at").eq("id", input.batchId).single<{ id: string; user_id: string; expires_at: string }>();
  if (!batch || batch.user_id !== user.id) return fail(404, "not_found", "That batch isn't yours or doesn't exist.");

  const plan = await planOf(user.id);
  if (input.sizeBytes > plan.maxBytes) return fail(413, "too_large", `The limit on your plan is ${formatBytes(plan.maxBytes)}.`);

  const id = crypto.randomUUID();
  const { count } = await db().from("videos").select("id", { count: "exact", head: true }).eq("batch_id", batch.id).neq("status", "deleted");
  const { data, error } = await db().from("videos").insert({
    id, user_id: user.id, batch_id: batch.id, position: count ?? 0, source: input.source, filename: input.filename,
    content_type: input.contentType, size_bytes: input.sizeBytes, status: "uploading", original_key: keys.original(user.id, id),
    // While ASK_RIGHTS is off nobody is asked, so the row says "not-asked" rather than claiming a confirmation.
    rights_attested_at: new Date().toISOString(), attestation_version: input.attest ? input.attestationVersion : RIGHTS_NOT_ASKED, expires_at: batch.expires_at,
  } as never).select().single();
  if (error?.message?.includes("batch_full")) return fail(409, "batch_full", "A batch holds 30 videos. Start a new batch for the rest.");
  if (error || !data) return fail(500, "db", "Couldn't record the video.");

  const upload = await signedUpload(keys.original(user.id, id), input.contentType);
  return json({ video: toVideo(data), upload }, 201);
}
