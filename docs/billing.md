# Credits and payments

Customers pay on Stripe-hosted pages only — **Checkout** for plans and credit packs, the
**Customer Portal** for cards, invoices and cancelling. Card details never reach the app.

## How credits work

- **One credit = one minute of calls** at the default rate. Each workspace has a `credits_per_minute`
  (Admin → Clients → Credits) to price it differently. Calls are billed by the second. A chatbot reply
  costs `chatReplyCredits` (0.05 by default).
- **Two buckets.** *Plan credits* are refilled to the plan's allowance on every paid renewal; leftovers
  expire. *Purchased credits* (packs, auto top-up, trial, adjustments) never expire. Usage spends plan
  credits first.
- **At zero, agents stop.** The agent asks for its configuration at the start of every call. With no
  credits it gets a 404 and hangs up before any AI provider is used. Otherwise the call's time
  limit is capped at what the balance can pay for, with a one-minute minimum. Chat widgets refuse
  new messages the same way.
- **Auto top-up.** When the balance falls below a threshold, the card saved at the last Checkout is
  charged off-session for the chosen pack, at most once every 10 minutes. Failures show on the
  Billing page.
- **Agencies.** Sub-accounts (`billing_mode = 'parent'`) spend their agency's wallet; every charge records
  which client used it, and Settings → Sub-accounts shows each client's usage this month. Agencies bill
  their own clients.
- **Existing workspaces** stay on `billing_mode = 'manual'` (invoiced as before, never blocked). New
  sign-ups get `credits` once `STRIPE_SECRET_KEY` is set (override with `BILLING_DEFAULT_MODE`).

Every balance change is a row in `credit_ledger`, unique on `(tenant_id, kind, ref)`. The ref is the
Stripe Checkout session, invoice or payment intent, the call id, or the chat reply. So a webhook
Stripe retries, or a call reported twice, is only counted once. Balances are updated under a row
lock in the same transaction as the ledger row.

## Setting up Stripe

1. Set `STRIPE_SECRET_KEY` (`sk_live_…`, or `sk_test_…` to try it).
2. Developers → Webhooks → add endpoint `https://<your app>/api/stripe/webhook` with these events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`,
   `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`,
   `payment_intent.succeeded`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Settings → Billing → Customer portal: turn on updating payment methods, invoice history and
   cancelling subscriptions.
4. Local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

Prices are sent to Checkout inline, so there are no products to create in Stripe first.

## Plans and packs per brand

`web/lib/billing/catalog.ts` holds the default catalog. **Its prices are placeholders; set your own
before launch.** A brand deployment overrides it with `BILLING_CATALOG` (JSON in the same shape), or a
brand package calls `registerCatalog(brand, catalog)`. A workspace's brand is the `BRAND_ID` of the
deployment where it signed up.

Plan changes go through the Billing page. Upgrades are charged straight away (prorated) and top up
plan credits immediately. Downgrades take effect at the next renewal.
