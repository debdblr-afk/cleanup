import { body, db, fail, isResponse, json, requireUser } from "@/lib/server/http";
import { priceFor, stripe, stripeEnabled } from "@/lib/server/billing";
import { checkout } from "@/lib/server/schemas";
import { SITE_URL } from "@/lib/supabase/env";

// POST /api/billing/checkout: a Stripe Checkout session for a plan. Needs a real account (email).
export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (user.is_anonymous || !user.email) return fail(403, "needs_account", "Sign in with your email before choosing a plan.");
  const input = await body(req, checkout);
  if (isResponse(input)) return input;
  const price = priceFor(input);
  if (!stripeEnabled() || !price) return fail(503, "payments_off", "Payments aren't set up yet.");

  const { data: profile } = await db().from("profiles").select("stripe_customer_id").eq("id", user.id).single<{ stripe_customer_id: string | null }>();
  let customer = profile?.stripe_customer_id ?? null;
  if (!customer) {
    const c = await stripe().customers.create({ email: user.email, metadata: { user_id: user.id } });
    customer = c.id;
    await db().from("profiles").update({ stripe_customer_id: customer } as never).eq("id", user.id);
  }
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { user_id: user.id } },
    allow_promotion_codes: true,
    success_url: `${SITE_URL}/account?checkout=success`,
    cancel_url: `${SITE_URL}/pricing?checkout=canceled`,
  });
  return json({ url: session.url });
}
