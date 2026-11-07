import { z } from "zod";
import { body, db, fail, isResponse, json, requireUser } from "@/lib/server/http";

// POST /api/dev/plan: development only (ALLOW_DEMO_PLAN=1, never in production builds).
// Sets the plan without payment so paid limits can be tried before Stripe keys exist.
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEMO_PLAN !== "1") return fail(404, "not_found", "Not found.");
  const user = await requireUser();
  if (isResponse(user)) return user;
  const input = await body(req, z.object({ plan: z.enum(["free", "plus", "pro"]) }));
  if (isResponse(input)) return input;
  await db().from("profiles").update({ plan: input.plan } as never).eq("id", user.id);
  return json({ ok: true });
}
