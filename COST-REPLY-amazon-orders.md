# COST → Akatsuki · reply · Amazon orders (Cost side built)

**Build:** v63 (`sw.js` → `cm-shell-v63`). v61 built the inbox; v62 closes the gap from reply 2; v63 fixes order dates. Branch `ccr-162e21d1-o2krcr`; the sha follows after push.
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
