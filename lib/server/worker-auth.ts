import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import { fail } from "./http";

// The server worker signs every request with WORKER_SECRET:
//   x-worker-id, x-worker-ts (unix seconds), x-worker-sig = hex HMAC-SHA256(secret, "ts.id.METHOD path.body")
// The path is signed too, so a captured request can't be replayed against another route, and
// requests older than 5 minutes are refused. worker/index.mjs builds the same string.
const MAX_SKEW_S = 300;

export function workerSignature(secret: string, ts: string, workerId: string, method: string, path: string, body: string): string {
  return createHmac("sha256", secret).update(`${ts}.${workerId}.${method} ${path}.${body}`).digest("hex");
}

/** Verifies the signature and parses the body. Returns the worker id and input, or an error response. */
export async function workerRequest<T>(req: Request, schema: z.ZodType<T>): Promise<{ workerId: string; input: T } | Response> {
  const secret = process.env.WORKER_SECRET;
  if (!secret || secret.length < 32) return fail(503, "worker_off", "The server worker isn't configured.");
  const workerId = req.headers.get("x-worker-id") ?? "";
  const ts = req.headers.get("x-worker-ts") ?? "";
  const sig = req.headers.get("x-worker-sig") ?? "";
  const raw = await req.text();
  if (!/^[\w.-]{8,64}$/.test(workerId) || !/^\d{9,11}$/.test(ts)) return fail(401, "unauthorized", "Bad worker signature.");
  if (Math.abs(Date.now() / 1000 - Number(ts)) > MAX_SKEW_S) return fail(401, "unauthorized", "Worker request expired.");
  const want = Buffer.from(workerSignature(secret, ts, workerId, req.method, new URL(req.url).pathname, raw));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return fail(401, "unauthorized", "Bad worker signature.");
  let json: unknown;
  try { json = raw ? JSON.parse(raw) : {}; } catch { return fail(400, "bad_json", "The request body isn't valid JSON."); }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return fail(400, "invalid", "Some fields are missing or wrong.");
  return { workerId, input: parsed.data };
}
