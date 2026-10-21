# COST → Akatsuki · feasibility check · Amazon orders from Gmail

**Ask:** check whether this can be done. **Do not build anything yet.** Reply with answers to the questions below, plus anything that blocks it.

## Goal

Amazon.co.jp orders should reach Cost Management without me typing them in. Every Amazon order sends a confirmation email to my Gmail (mangaonkaraniket@gmail.com). Amazon has no API for personal accounts, so that email is the only source.

Planned flow:

```
Gmail (Amazon order emails)
  → producer reads the email (order no., date, total, items if present)
  → akatsuki_publish  kind: order.detected   to: cost
  → Cost: listen() handler → "to confirm" list → I pick a category → expense
```

Rules on Cost's side:
- Nothing becomes an expense without my confirmation. The emailed total is the checkout total; split shipments, cancellations and refunds can change what is actually charged.
- Cost renders from the hub inbox and does not copy rows into localStorage. This is the same pattern as `purchase_request` (R013).

## Proposed contract (change it if the hub has a better fit)

- **kind `order.detected`**
  - `addr`: `{ source: "amazon", order_id }`
  - `payload`: `{ source, order_id, ordered_at, total, currency: "JPY", items: [{ name, qty?, price? }]?, email_id }`
- **kind `order.cancelled`**
  - `addr`: `{ source: "amazon", order_id }`
  - `payload`: `{ order_id, refund_total? }`
- **Idempotency key:** `amazon:<order_id>:<kind>`. The same email read twice must produce one row.
- **Cost's reply** when I confirm or drop one: `order.resolved`, with `{ order_id, status: "logged" | "dismissed", expense_ids? }`.

## Questions for Akatsuki

1. **Producer.** Does Akatsuki already have an app that reads Gmail (a mail or inbox app, or any email ingestion)? If yes, which app id should publish, and does it already read Amazon emails?
2. **Auth for a headless producer.** If nothing exists, my plan is this:
   - A Google Apps Script in my Gmail runs every 15 minutes.
   - It posts to a Supabase edge function, protected by a shared secret.
   - That function calls `akatsuki_publish` as `from_app: "mail"`.

   Can `akatsuki_publish` be called from an edge function on behalf of my user, either with the service role while still setting the owner correctly, or by some other means? Who owns the row: the app, or `auth.uid()`? I do not want a service-role key inside Apps Script.
3. **Vocab and routes.** What does registering a new kind and opening the `mail → cost` route take? Is it the same shape as `akatsuki_card_cost_R002.sql`? Should these kinds instead be generic (for example `purchase.detected` with `source`), so that card statements or other shops can use them later?
4. **Fit with `purchase_request`.** Should an Amazon order reuse the R013 `purchase_request` / `purchaseResolved` path? Or should it stay a separate kind, because it is a purchase that already happened rather than a request?
5. **Cancellations and updates.** Can a later `order.cancelled` reference the earlier `order.detected` by `addr`, so that Cost can drop it from the inbox, or flag it if it was already logged?
6. **Backfill.** Is a one-off import of past orders (Amazon's data export CSV, or old emails) acceptable through the same kind? Or does that need a bulk path, given the publish rate and size limits?
7. **Privacy.** Item names and order details would sit in hub rows. Does anything there need to be minimised, or expire after it has been consumed?
8. **Anything that makes this not feasible,** or a simpler route I'm missing.

## Cost's side (for reference, not for Akatsuki to build)

- `js/cost-adapter.js` gets a `listen()` handler for `order.detected` / `order.cancelled` next to `purchase_request`, plus `orderResolved()`.
- `js/app.jsx` gets an "Amazon orders to confirm" list modelled on the Stops panel, with Log (category picker, amount prefilled) and Not mine / cancelled.

**Reply format:** a numbered answer for each question, the final kind names and payloads, and the SQL or RPC names Cost should call.
