# COST · code review · online orders v61–v66 · 2026-10-27

**Scope:** every app change since the orders inbox was added (`0de9487^..HEAD`): `js/app.jsx`, `js/cost-adapter.js`, `migrations/017_order_lines.sql`. All of it is merged into `main` (PRs #4–#7). **Nothing has been fixed yet;** this is the report.
**Already-logged data is correct.** The 11 orders, their 25 lines and the 19 linked expenses were checked live and match. None of the issues below changed anything that is in the database today.

## Real bugs

| # | Severity | Where | What goes wrong | Fix |
|---|---|---|---|---|
| 1 | **High** | `js/cost-adapter.js` `purchase.cancelled` handler | A cancellation for an order that is **already logged** is turned into a `flagged` reply with one `akatsuki_ack` call. If that call fails (a transient error is enough), `consume()` acks the cancellation `rejected` and it is never re-delivered. The UI then hides the order (reply still `logged`), so the red "logged but cancelled" card never appears and the expense stays silently in History. | Treat `reply.status === 'logged'` **plus a cancel row** as flagged in `orderIsOpen` / the card, so the warning depends on the cancel row (which Cost already fetches), not on the flag write. |
| 2 | **Medium** | `js/app.jsx` `orderItems` | Items without a name are filtered out **before** indices are assigned. With `[A, (no name), B]`, B becomes index 1. The `index` in the hub reply (`lines`, `excluded`) and `line_index` in `cost_management_order_lines` then point at the wrong product. No live order has a nameless item, so nothing is wrong today. | Map with the original index first, then filter. |
| 3 | **Medium** | `js/app.jsx` `OrdersInboxView.log` | No `try/finally`: any thrown error leaves `busy` set, so the card stays at 60 % opacity with every control disabled until the app is reloaded. Also, a v61-era mark (`cm_order_logged[seq] = <id>`, bare id) is read back as `{ids:[id]}` with no `lines`, and `mark.lines.find(...)` throws. No order was logged on v61–v63, so only the first half matters in practice. | Wrap the body in `try/finally { setBusy(null) }`; treat a mark without `lines` as "insert again is unsafe, so rebuild `lines` from `ids`" or clear it with a message. |
| 4 | **Low** (closed off by 017 being applied) | `js/app.jsx` `saveOrderLines` + `OrderHistoryView.load` | `saveOrderLines` dispatches `ORDER_LINES_EVT` even when the upsert **failed**; `load()` listens to that event and, seeing pending rows, calls `saveOrderLines([])` again: an unbounded retry loop of failing requests. It cannot start now that the table exists, but any future persistent error (RLS, outage) would trigger it. | Dispatch the event only on success, or have `load()` not retry pending rows on an event it itself caused. |
| 5 | **Low** · *the person's own v62 change* | `js/app.jsx` `addNewShop` (area picker) | The duplicate check matches on **name only, across all categories**. Adding "Aeon" under Pharmacy when "Aeon" exists under Supermarket ticks the Supermarket shop and creates nothing; with a category scope the ticked shop is not even visible. | Match on name **and** category, or offer "use existing / create anyway". |

## Performance (fine today, worth doing before volumes grow)

| # | Where | What | Fix |
|---|---|---|---|
| 6 | `OrdersInboxView` | `matchesFor` (tokenising every open wishlist / purchase card) and `orderDupOf` (scanning all expenses) run per item on **every render**, including each keystroke in a price or shop box. | `useMemo` the matches per order, keyed on items + cards; memoise `matchTokens` per name. |
| 7 | `cost-adapter.js` `orderInbox` | Fetches **every** `purchase.*` row ever received, with payloads, and `reloadOrders` runs once per consumed hub row (a backfill of N orders = N full reads). | Filter server-side (`reply is null or reply->>status = 'flagged'`), add a `limit`, and debounce reload per consume batch. |

## Not a bug (checked and dismissed)

- **"Re-acking with `p_b_addr` null wipes the expense link."** False. `akatsuki_ack` only writes `akatsuki_links` inside `if p_b_addr is not null`. A null leaves the existing link alone. Verified against the live function definition.

## Suggested order of work
1 → 3 → 2 → 4 in one small push (≈20 lines), then 6 and 7 together, then 5 (the person's call, since it is their change).

---

# Pending phases · as of 2026-10-27

## Done since the last list
- Skip asks why (v66): merged, PR #7.
- July order (249-5735958) will not be re-sent: the script skips that email for good.
- Backfill of all 25 order lines, with the Jul 15 lines marked "paid by someone else".
- Migration 017 applied by the person; `COST-REPLY-amazon-orders.md` brought up to date (routes live, R048).
- Fares: handover asked, Akatsuki agreed, Cost replied with the engine data (`COST-fare-engine-data.json`).

## A · Online orders (Amazon)
| Item | Owner | Status |
|---|---|---|
| Fix review bugs 1–4 above | Cost | **open, next** |
| Performance 6–7 | Cost | open, low |
| Shop-picker duplicate (5) | person / Cost | open, low |
| Pass `COST-REPLY-amazon-orders.md` (v64–v66 sections) to Akatsuki | person | open |
| Quick "paid by someone else" options Akatsuki proposed ("Rest: someone else paid", editing a line in history) | — | **not planned**: the person chose Skip-asks-why only |
| Note on the four Jul 15 lines | person | optional |

## B · Train fares handover (Akatsuki R052)
| Phase | Owner | Status |
|---|---|---|
| Ekispert plan: endpoints, monthly limit, terms | **person** | **open, blocks Akatsuki** |
| Approve deleting `super-task`, `smooth-endpoint`, `fare-lookup` (`super-task` first: uncapped Google Places, anon-reachable) | **person** | **open** |
| Pass `COST-REPLY-fares.md` + `COST-fare-engine-data.json` to Akatsuki | person | open |
| 1 · Build `akatsuki-fare`, stations table, cap, fare-revision vocab | Akatsuki | waiting on the two items above |
| 2 · Shadow: Cost shows its own fare, asks the hub in the background, logs both (Cost migration 018) | Cost | after phase 1 |
| 3 · Hub first, Cost engine as fallback | Cost | after the person confirms "mastered" |
| 4 · Retire Cost's lookup (offline engine stays) | person's decision | — |

## C · Housekeeping
| Item | Status |
|---|---|
| Merge the branch (3 note commits + this review; no app change) | open |
| `migrations/README.md` still says 013/014/017 "not yet applied": all three are applied | open, small |
| Wishlist card says "cap ¥2,036": rename to "wishlist price … (date)" so an old sale price is not read as agreed | open, small |

## D · Parked ideas
- Stops: show where a stop falls in the day; reminder right after leaving; auto-save a spot once named.
- Convert the app to Vite: low priority by the person's choice.
