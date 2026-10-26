import type Stripe from "stripe";
import { sql } from "@/lib/db";
import { fulfilCheckoutSession, fulfilInvoice, fulfilPaymentIntent, stripe, syncSubscription } from "@/lib/billing/stripe";

// Stripe → app. Every event is verified against STRIPE_WEBHOOK_SECRET. Handlers are idempotent (the
// credit ledger rejects a repeated Stripe object id), so Stripe's retries are safe. A failure returns
// 500 so Stripe retries later.
//
// Subscribe the endpoint to: checkout.session.completed, checkout.session.async_payment_succeeded,
// invoice.paid, customer.subscription.created, customer.subscription.updated,
// customer.subscription.deleted, payment_intent.succeeded.
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature) return new Response("Not configured", { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return new Response("Bad signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await fulfilCheckoutSession(event.data.object);
        break;
      case "invoice.paid":
        await fulfilInvoice(event.data.object);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object);
        break;
      case "payment_intent.succeeded":
        await fulfilPaymentIntent(event.data.object);
        break;
    }
  } catch (e) {
    console.error(`stripe webhook ${event.type} ${event.id} failed`, e);
    return new Response("Handler failed", { status: 500 });
  }

  await sql`INSERT INTO stripe_events (id, type) VALUES (${event.id}, ${event.type}) ON CONFLICT DO NOTHING`;
  return Response.json({ received: true });
}
