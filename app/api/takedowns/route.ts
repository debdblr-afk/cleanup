import { body, db, fail, isResponse, json } from "@/lib/server/http";
import { sendEmail } from "@/lib/server/email";
import { takedown } from "@/lib/server/schemas";

// POST /api/takedowns: public copyright complaint form. Stored, and the admin is emailed.
export async function POST(req: Request) {
  const input = await body(req, takedown);
  if (isResponse(input)) return input;
  const { data, error } = await db().from("takedown_requests").insert({
    reporter_name: input.reporterName, reporter_email: input.reporterEmail, rights_holder: input.rightsHolder,
    work_description: input.workDescription, infringing_ref: input.infringingRef, good_faith_statement: true, signature: input.signature,
  } as never).select("id").single<{ id: string }>();
  if (error || !data) return fail(500, "db", "Couldn't record the notice. Please try again.");
  const admin = process.env.ADMIN_EMAIL;
  if (admin) await sendEmail(admin, "New takedown notice", `A copyright notice was filed (id ${data.id}). Review it in the database (takedown_requests).`, "takedown_admin");
  return json({ id: data.id }, 201);
}
