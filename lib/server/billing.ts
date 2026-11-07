import "server-only";
import Stripe from "stripe";
import { db } from "./http";

export const stripeEnabled = () => Boolean(process.env.STRIPE_SECRET_KEY);

let client: Stripe | null = null;
/** API client. Only call when stripeEnabled(); checkout and portal return 503 otherwise. */
export function stripe(): Stripe {
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY!);
  return client;
}

/** Signature checking needs no API key; this instance is never used for API calls. */
const verifier = new Stripe("unused-for-signature-checks-only");
export function verifyEvent(raw: string, signature: string | null): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signature) throw new Error("missing signature or secret");
  return verifier.webhooks.constructEvent(raw, signature, secret);
}

type PlanKey = { plan: "plus" | "pro"; interval: "month" | "year" };

export function priceFor(k: PlanKey): string | undefined {
  return process.env[`STRIPE_PRICE_${k.plan.toUpperCase()}_${k.interval.toUpperCase()}`] || undefined;
}

export function planForPrice(priceId: string): PlanKey | null {
  for (const plan of ["plus", "pro"] as const)
    for (const interval of ["month", "year"] as const) if (priceFor({ plan, interval }) === priceId) return { plan, interval };
  return null;
}

async function userForSubscription(sub: Stripe.Subscription): Promise<string | null> {
  const fromMeta = sub.metadata?.user_id;
  if (fromMeta) {
    const { data } = await db().from("profiles").select("id").eq("id", fromMeta).maybeSingle<{ id: string }>();
    if (data) return data.id;
  }
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const { data } = await db().from("profiles").select("id").eq("stripe_customer_id", customer).maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

/**
 * Mirror one subscription into the database and recompute the user's plan.
 * Events can arrive late or out of order: anything older than what we already applied is ignored.
 */
export async function applySubscription(sub: Stripe.Subscription, eventCreated: number): Promise<"applied" | "stale" | "unknown_user" | "unknown_price"> {
  const userId = await userForSubscription(sub);
  if (!userId) return "unknown_user";
  const item = sub.items.data[0];
  const price = item?.price;
  const mapped = price ? planForPrice(price.id) : null;
  if (!price || !mapped) return "unknown_price";
  const eventAt = new Date(eventCreated * 1000).toISOString();

  const { data: existing } = await db().from("subscriptions").select("stripe_event_at").eq("stripe_subscription_id", sub.id).maybeSingle<{ stripe_event_at: string }>();
  if (existing && new Date(existing.stripe_event_at).getTime() > eventCreated * 1000) return "stale";

  const periodEnd = (item as unknown as { current_period_end?: number }).current_period_end
    ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const { error } = await db().from("subscriptions").upsert({
    user_id: userId, stripe_subscription_id: sub.id, stripe_customer_id: customer, stripe_price_id: price.id,
    plan: mapped.plan, billing_interval: price.recurring?.interval === "year" ? "year" : "month",
    status: sub.status, amount_cents: price.unit_amount ?? 0, currency: price.currency,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end, stripe_event_at: eventAt,
  } as never, { onConflict: "stripe_subscription_id" });
  if (error) throw error;
  await db().from("profiles").update({ stripe_customer_id: customer } as never).eq("id", userId).is("stripe_customer_id", null);
  await db().rpc("refresh_plan", { p_user: userId } as never);
  return "applied";
}
