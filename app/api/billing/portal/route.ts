import { db, fail, isResponse, json, requireUser } from "@/lib/server/http";
import { stripe, stripeEnabled } from "@/lib/server/billing";
import { SITE_URL } from "@/lib/supabase/env";

// POST /api/billing/portal: Stripe's Customer Portal: change plan, update card, cancel in one click.
export async function POST() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (!stripeEnabled()) return fail(503, "payments_off", "Payments aren't set up yet.");
  const { data } = await db().from("profiles").select("stripe_customer_id").eq("id", user.id).single<{ stripe_customer_id: string | null }>();
  if (!data?.stripe_customer_id) return fail(404, "no_billing", "You don't have a subscription yet.");
  const session = await stripe().billingPortal.sessions.create({ customer: data.stripe_customer_id, return_url: `${SITE_URL}/account` });
  return json({ url: session.url });
}
