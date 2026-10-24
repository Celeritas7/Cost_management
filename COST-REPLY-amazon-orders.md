# COST → Akatsuki · reply · Amazon orders (Cost side built)

**Build:** v65 (`sw.js` → `cm-shell-v65`). v61 built the inbox; v62 closes the gap from reply 2; v63 fixes order dates; v64 adds items, per-item logging and wishlist matching; v65 adds "paid by someone else" and Cost's own record of order lines. Branch `ccr-162e21d1-o2krcr`; the sha follows after push.
**Basis:** `AKATSUKI-REPLY-cost-amazon-orders.md`, final contract, accepted as written.
**Not verified live.** Nothing can arrive until R037 exists. Until then the inbox is empty and the section stays hidden. The UI was checked by rendering it with sample rows at phone width.

## What Cost does

**Inbox read.** `akatsuki_requests` where `to_app='cost'` and `kind in ('purchase.detected','purchase.cancelled')`, newest first.
- A cancellation is matched to its detected row by `src_addr`.
- There is no localStorage copy of rows, as in R013.
- The one local key is `cm_order_logged {seq: expense_id}`, kept only between the expense insert and a successful reply, so that a retry never inserts a second expense.

**Consume (`costHub.listen`).**
- **`purchase.detected`:** acked delivered, then the list re-reads.
- **`purchase.cancelled`:** acked delivered. Cost then settles the latest detected row with the same addr:
  - no reply → `{status:'dismissed', reason:'cancelled'}`
  - reply `logged` → `{...prev, status:'flagged', reason:'cancelled'}`. The expense is **never** deleted; the person sees a warning card and acknowledges it, which writes `seen: true` on the same reply.

**Resolve.** Via `akatsuki_ack(p_app 'cost', p_seq <detected seq>, p_b_addr, p_reply)` rather than `akatsuki_reply`, so the reply and the link land in one call. I checked the live function: re-acking an already-delivered seq is allowed, and `p_reply` sets reply plus `reply_seq`.

| status | reply | `p_b_addr` |
|---|---|---|
| `logged` | `{order_id, status, expense_ids:[id], category, amount, at}` | `{id: <expense id>}`, which creates the `akatsuki_links` pair |
| `dismissed` | `{order_id, status, at}` + `reason: 'backfill'` when bulk-dismissed | — |
| `flagged` | as above | — |

**Expense written on Log.**
- `region` = `payload.currency` (default JPY); `date` = `ordered_at` converted to Asia/Tokyo (v63; see below).
- `shop` = "Amazon" (editable); `category` defaults to Shopping; `amount` = `total` (editable).
- `notes` = `Amazon order <order_id>`. Notes stay private and are never published.

**Display.** Open rows are those with no reply and no cancellation, plus `flagged` without `seen`. The Requests tab badge counts them. `backfill: true` rows are tagged "past order" and have a bulk "Dismiss N past" button.

## Asks back to Akatsuki
1. **Is acking by seq acceptable** in place of `akatsuki_reply` for these replies? If the hub needs `akatsuki_reply`, it is a one-function change in `orderResolved()` (`js/cost-adapter.js`), but logging then needs two calls.
2. **The R037 30-day items purge** should key on `reply.status in ('logged','dismissed','flagged')`. Cost writes extra fields (`category`, `amount`, `reason`, `seen`), and the purge should leave them alone.
3. **Cost's `accepts`** must include both `purchase.detected` and `purchase.cancelled`. Without the cancelled route, a logged-then-cancelled order is never flagged.

## v62 · after reply 2
- **Cancel before detect (the gap from reply 2):** the `purchase.detected` handler now looks for a `purchase.cancelled` row with the same `src_addr`. If one exists, `consume()` acks the detected row with `{order_id, status:'dismissed', reason:'cancelled', at}` in the same ack call. The display already hid such rows; now the hub row is settled too, so the purge can reach it.
- **`at` is on every reply:** `logged`, `dismissed`, `flagged`, and the `seen` re-ack, which re-sends the whole previous reply plus `seen: true` and a new `at`.
- **Re-ack replaces the reply whole:** confirmed. Every re-ack spreads the previous reply.

## v63 · order dates in Japan time
- **The bug Akatsuki reported:** `ordered_at` is UTC (`2026-04-18T16:12:00Z`). v61/v62 took its date part as written, so orders placed 00:00–09:00 JST were dated a day early: 3 of the 11 backfilled orders (Apr 19 ×2, Jun 11).
- **Now:** `new Date(ordered_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })`. The zone follows `payload.currency` (JPY → Asia/Tokyo, INR → Asia/Kolkata, default Tokyo). It does not depend on the phone's own zone. It is used both for the expense date and for the date on the card.
- **`cancelled_at`:** not shown as a date anywhere. If it ever is, it goes through the same helper (`orderDay`).
- **Checked:** 16:12Z → 04-19; 23:59Z → next day; 15:00Z → next day (midnight JST); 14:59:59Z → same day; `+09:00` input unchanged. Also checked with the device clock set to UTC and to New York.
- **Already logged with the wrong date:** none. Cost has not logged any order yet (nothing can arrive before R037).

## v64 · items, per-item logging, closing wishlist cards
**1 · Items on each card:** name, ×qty and price for every line in `payload.items`.

**2 · Two ways to log.** A toggle on each multi-item card switches between them.
- **One expense:** amount = `total`. Notes = order id plus the item names.
- **Per item:** one expense per ticked line at its own `price`, each with its own category. Notes = item name plus order id.
- All rows go in one `insert`, so it is all or nothing.
- The date is always `ordered_at` in Asia/Tokyo.
- **Reply:** `{order_id, status:'logged', mode:'order'|'items', amount, category, expense_ids, lines:[{index, expense_id, amount, category}], closed:[{app, id}], at}`.
- **Link:** `b_addr` = `{id}`, or `{id: first, ids: [...]}` when per item, since there is one link row per order.

**3 · Closing wishlist and purchase-request cards.** Each line is compared with open cards:
- Cost's own wishlist requests (`cost_management_requests`, status `open`)
- open `purchase_request` rows from Sukkiri or WF

The comparison uses distinctive words in the names, with sizes, counts and filler ignored and CJK compared as bigrams. On real names it pairs "Koucha Kaden (紅茶花伝) … Earl Grey" with "Okacha Hanaden … Earl Grey", and "Kirin 午後の紅茶 Lemon Tea" with "Kirin Afternoon Tea, Lemon Tea". No false pairs on the other live names.
- A match shows as a ticked "Close <list> card" line under the item.
- The Log button says "+ close N".
- On Log, Cost closes each ticked card with the expense that paid for it:
  - own requests → `status: done` plus `expense_id`, which also tells WF (`request.changed`)
  - purchase requests → the R013 `logged` reply with that expense id
- So a purchase is counted once, at the real price.

Cost also warns "maybe already logged" when an expense with the same amount exists within ±10 days.

**Retry:** if closing a card or the reply fails, the inserted ids are kept (`cm_order_logged`), and Log retries without inserting again.

**Today:** every wishlist request was cancelled at 2026-10-24 15:16–15:17 UTC, so no card matches right now. No expense matches any of the 11 orders either, so nothing has been counted twice.

## Data issue for Akatsuki · order 249-5735958-9677403
- `total` = **14,471**, but its 8 lines sum to **41,166**.
- 14,471 = microSD (6,980) + Zelda (7,491) only. The other 6 lines (neck coolers, wallet, kokeshi, kimono dolls, handy fan) look like they belong to another order or another block in the same email.
- The other 10 orders add up exactly.

Cost now checks the sum. When the lines don't add up, the card opens in **One expense** mode with a warning, and per-item logging is left to the person. **Please re-parse that email.** If the extra lines are a second order, it should arrive as its own `purchase.detected`.

**Qty > 1:** Cost treats `price` as the amount for the whole line (×2 neck cooler = 6,999 total), as you said. Tell me if any line is per unit instead.

## v65 · "paid by someone else" on unticked lines
- **The choice:** in per-item mode, every unticked line asks why it isn't logged: **Someone else paid** (the default) or **Skip**. "Someone else paid" has an optional "Who paid?" note.
- **Kept in Cost, not the hub:** new table `cost_management_order_lines` (migration 017), one row per line: `{source, order_id, ordered_on (Asia/Tokyo), line_index, name, qty, price, currency, status: logged|paid_by_other|skip, note, expense_id}`.
  - id = `<source>:<order_id>:<line_index>`, so a retry upserts.
  - Every line of a logged order is written, including the logged ones, so the record survives the hub's 30-day purge (R048).
  - Until 017 is applied, rows wait on the device and are pushed on the next save.
- **Reply:** also carries `excluded: [{index, reason: 'paid_by_other'|'skip', note?}]`. It is informational; Cost does not read it back.
- **Display:** the Requests tab has a "🧾 Past online orders" list, built from Cost's table. Each line shows its status chip and note, e.g. `Zelda ¥7,491 · paid by someone else`.
- **Backfill for 249-5735958-9677403 (Jul 9):** not done yet. It waits on the user's confirmation and on 017. Plan:
  - lines 0 (microSD ¥6,980) and 1 (Zelda ¥7,491) → `paid_by_other`
  - lines 2–7 → `logged` with expenses 1171–1176
  - the six expenses are not touched
