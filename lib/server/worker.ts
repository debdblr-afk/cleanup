import "server-only";
import { db } from "./http";

export type WorkKind = "jobs" | "exports";
type Owned = { id: string; user_id: string; status: string; worker_ref: string | null; video_id?: string; job_id?: string; quota_date: string };

/** The work item, if this user owns it (any user for the server worker: null) and this worker still holds it. */
export async function heldWork(kind: WorkKind, id: string, userId: string | null, workerId: string): Promise<Owned | null> {
  const table = kind === "jobs" ? "removal_jobs" : "exports";
  const cols = kind === "jobs" ? "id, user_id, status, worker_ref, video_id, quota_date" : "id, user_id, status, worker_ref, job_id, quota_date";
  const { data } = await db().from(table).select(cols).eq("id", id).single<Owned>();
  if (!data || (userId !== null && data.user_id !== userId) || data.worker_ref !== workerId) return null;
  const active = kind === "jobs" ? ["detecting", "rendering"] : ["rendering"];
  return active.includes(data.status) ? data : null;
}

export async function videoIdFor(kind: WorkKind, row: Owned): Promise<string | null> {
  if (kind === "jobs") return row.video_id ?? null;
  const { data } = await db().from("removal_jobs").select("video_id").eq("id", row.job_id!).single<{ video_id: string }>();
  return data?.video_id ?? null;
}
