import type Stripe from "stripe";
import { db, fail, json } from "@/lib/server/http";
import { applySubscription, verifyEvent } from "@/lib/server/billing";
import { sendEmail } from "@/lib/server/email";

// POST /api/webhooks/stripe. Verify the signature, record the event id first (a repeat
// delivery hits the primary key and is skipped), then apply it. Subscription state comes
// from the event's own subscription object with an event-time guard, so no API calls here.
export async function POST(req: Request) {
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = verifyEvent(raw, req.headers.get("stripe-signature"));
  } catch {
    return fail(400, "bad_signature", "Signature check failed.");
  }

  const { error: dup } = await db().from("stripe_events").insert({ id: event.id, type: event.type } as never);
  if (dup?.code === "23505") return json({ received: true, duplicate: true });
  if (dup) return fail(500, "db", "Couldn't record the event.");

  let outcome = "ignored";
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const customer = typeof s.customer === "string" ? s.customer : s.customer?.id;
        if (s.client_reference_id && customer) {
          await db().from("profiles").update({ stripe_customer_id: customer } as never).eq("id", s.client_reference_id).is("stripe_customer_id", null);
        }
        outcome = "linked";
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        outcome = await applySubscription(event.data.object as Stripe.Subscription, event.created);
        break;
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        if (inv.customer_email) {
          await sendEmail(inv.customer_email, "Your Cleanup payment didn't go through",
            "We couldn't charge your card for Cleanup. Stripe will try again over the next few days. You can update your card from the Your videos page (Manage billing). Your plan stays active meanwhile.",
            "payment_failed");
        }
        outcome = "notified";
        break;
      }
    }
    await db().from("stripe_events").update({ processed_at: new Date().toISOString() } as never).eq("id", event.id);
    return json({ received: true, outcome });
  } catch (e) {
    // Leave the event recorded with the error and let Stripe retry: delete the marker so the retry runs.
    await db().from("stripe_events").delete().eq("id", event.id);
    console.error(`[stripe] ${event.type} failed: ${e instanceof Error ? e.message : "error"}`);
    return fail(500, "handler", "Processing failed; Stripe will retry.");
  }
}
