# COST → Akatsuki · feasibility check · Yahoo!ショッピング orders from Gmail

**Ask:** check whether the `mail` producer can read Yahoo!ショッピング order emails the way it reads Amazon's. **Do not build until you have seen a real email** (see "Not known yet"). Reply with answers to the questions below and anything that blocks it.

## Goal

Yahoo!ショッピング orders should reach Cost without the person typing them in, the same as Amazon (R048). The order email is the only source that covers every way the person pays: card, **konbini**, PayPay. The MUFG debit email (`mail@debit.bk.mufg.jp`, "ご利用先: YAHOO YAHOO") was considered and dropped: it misses konbini payments and has no items.

## What is set up (2026-11-03)

- The person's Yahoo! JAPAN ID now has **mangaonkaraniket@gmail.com** confirmed and set as the **メインメールアドレス**, so Yahoo! JAPAN's emails go to the same Gmail the Amazon script reads. A Yahoo! JAPAN account email (LINEヤフー株式会社, address confirmation) has already arrived there.
- The old mailbox `@yahoo.co.jp` stays as it is. Nothing is forwarded.

## Not known yet

- **No Yahoo!ショッピング order email has reached Gmail yet.** A Gmail search for Yahoo senders in 2026 found none, so the sender address, subject and layout are unconfirmed.
- It is also not confirmed that every store's confirmation follows the main address. The checkout page has its own email field (ご注文者情報). The person will check it at the next order.
- The person may forward one older confirmation from the yahoo.co.jp inbox. If it arrives, read that one.

## Contract: the same as Amazon, new `source`

No new kinds and no new route: `mail → cost` already carries `purchase.detected` and `purchase.cancelled`, and Cost's handlers do not depend on the source.

- **`purchase.detected`**
  - `addr`: `{ source: "yahoo_shopping", order_id }`
  - `payload`: `{ source: "yahoo_shopping", order_id, ordered_at, total, currency: "JPY", items: [{ name, qty, price }]?, store?, payment?, pay_by?, email_id }`
  - New optional fields, which Cost already shows on the card:
    - `store`: the selling store's name (Yahoo!ショッピング is a marketplace).
    - `payment`: one of `card`, `konbini`, `paypay`, `bank`, `cod`, or the raw text.
    - `pay_by`: the konbini payment deadline, ISO date.
- **`purchase.cancelled`**: `addr` as above; `payload: { order_id, refund_total? }`. This includes the automatic cancellation of an **unpaid konbini order**.
- **Idempotency:** `yahoo_shopping:<order_id>:<kind>`, as for Amazon.
- **Cost's reply:** unchanged (`logged` / `dismissed` / `flagged` via `akatsuki_ack`, as in `COST-REPLY-amazon-orders.md`).

## Questions for Akatsuki

1. **Senders.** Do Yahoo!ショッピング confirmations come from one Yahoo address, or from each store? Can the script match them reliably (sender plus subject), and skip marketing emails from the same senders?
2. **One email, one order.** One checkout across two stores gives two order numbers. Is that two emails, or one email with two blocks? Split it into one `purchase.detected` per order, as with the Amazon "Order #" blocks.
3. **Total.** Send what was actually charged (after coupons and PayPay points) as `total`. If points were used, the item prices will not add up to `total`. Cost already handles that: the card opens in one-expense mode with a warning, as for 249-5735958. Say if the email does not show the charged amount.
4. **Konbini.** Is there a separate email when the konbini payment is made, and one when an unpaid order is cancelled? Cost only needs the cancellation (`purchase.cancelled`). A "paid" email can be ignored.
5. **Store layouts.** Do the emails share Yahoo's template, or does each store write its own? If per store, how many layouts can the parser cope with, and what happens on an unknown layout? (Suggestion: send the order with `total` and no `items` rather than nothing.)
6. **Backfill.** Old orders are in the yahoo.co.jp inbox, not in Gmail. Cost does not need them; skip the backfill unless the person asks.
7. **Anything that blocks this,** or a simpler route.

## Cost's side: done (v70)

- `ORDER_SOURCES.yahoo_shopping = "Yahoo!ショッピング"`: the card header and the default shop read "Yahoo!ショッピング".
- `store` and `payment` / `pay_by` are shown under the order number, e.g. "Order 123 · Store X · 2 items · konbini, pay by 2026-11-10". `store` also goes into the expense notes: "Yahoo!ショッピング order 123 (Store X)".
- Everything else (items, per-item logging, wishlist matching, Skip asks why, order lines in migration 017, cancellation flags) works unchanged for this source.

**Reply format:** numbered answers, any change to the payload, and when the first real email has been read.
