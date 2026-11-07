import "server-only";
import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { planIdFor } from "@/lib/rows";
import { PLANS, type Plan } from "@/lib/plans";
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });

export const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  json({ error: { code, message, ...extra } }, status);

/** Parse and validate a JSON body. Returns the data or a 400 response. */
export async function body<T>(req: Request, schema: z.ZodType<T>): Promise<T | Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail(400, "bad_json", "The request body isn't valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid", "Some fields are missing or wrong.", { issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })) });
  return parsed.data;
}

export async function requireUser(): Promise<User | Response> {
  const user = await currentUser();
  return user ?? fail(401, "unauthenticated", "Sign in or start a guest session first.");
}

/** The limits that apply to this user. Everyone has the same plan for now (DEFAULT_PLAN). */
export async function planOf(userId: string): Promise<Plan> {
  void userId; // kept so per-user limits can come back without touching the routes
  return PLANS[planIdFor()];
}

export const db = () => supabaseAdmin();

export function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

export function hoursUntilReset() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 3_600_000));
}

export async function consumeQuota(userId: string, kind: "preview" | "export", cap: number): Promise<boolean> {
  const { data, error } = await db().rpc("consume_quota", { p_user: userId, p_kind: kind, p_cap: cap } as never);
  if (error) throw error;
  return data === true;
}

export async function refundQuota(userId: string, kind: "preview" | "export", date: string) {
  await db().rpc("refund_quota", { p_user: userId, p_kind: kind, p_date: date } as never);
}

export const isResponse = (v: unknown): v is Response => v instanceof Response;
