# COST · code review · online orders v61–v66 · 2026-10-27

**Scope:** every app change since the orders inbox was added (`0de9487^..HEAD`): `js/app.jsx`, `js/cost-adapter.js`, `migrations/017_order_lines.sql`. All of it is merged into `main` (PRs #4–#7). **Bugs 1–4 were fixed in v67 (2026-11-03); 5–7 in v68**; see the end of this file.
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

# Pending phases · as of 2026-11-03

## Checked on 2026-11-03
- Akatsuki has **deleted `super-task` and `smooth-endpoint`** (the uncapped Google Places risk is gone). `fare-lookup` still exists; Cost does not call it.
- Fares R052 **not started** on the hub: no `akatsuki_stations` table, no `akatsuki_budget_take`.
- **No new Amazon orders since 2026-10-25.** If anything was ordered since, ask Akatsuki whether the Gmail script is still running.
- Order lines: 25 rows, unchanged. All 11 orders resolved.

## Done since the last list
- Skip asks why (v66): merged, PR #7.
- July order (249-5735958) will not be re-sent: the script skips that email for good.
- Backfill of all 25 order lines, with the Jul 15 lines marked "paid by someone else".
- Migration 017 applied by the person; `COST-REPLY-amazon-orders.md` brought up to date (routes live, R048).
- Fares: handover asked, Akatsuki agreed, Cost replied with the engine data (`COST-fare-engine-data.json`).

## A · Online orders (Amazon)
| Item | Owner | Status |
|---|---|---|
| Fix review bugs 1–4 above | Cost | **done in v67**, merged (PR #9) |
| Performance 6–7 | Cost | **done in v68** |
| Shop-picker duplicate (5) | Cost | **done in v68** (see below: name-only match kept, on purpose) |
| Pass `COST-REPLY-amazon-orders.md` (v64–v66 sections) to Akatsuki | person | open |
| Quick "paid by someone else" options Akatsuki proposed ("Rest: someone else paid", editing a line in history) | — | **not planned**: the person chose Skip-asks-why only |
| Note on the four Jul 15 lines | person | optional |

## B · Train fares (R052): **paused** (2026-11-03)
The Ekispert key is on the Free plan (railway data only); route search, the only call that returns a fare, needs the company-only Standard plan. The person paused R052. Cost keeps its own stack (fare book → cache → `jrCompute` → typed fare); phases 2–4 are off until a fare source exists. R052 stays reserved at the hub with Cost's engine data on file.

| Item | Owner | Status |
|---|---|---|
| Delete `fare-lookup` in the Supabase dashboard (nothing live calls it; checked 2026-11-03) | person | **done** (gone from the edge functions, checked 2026-11-03) |
| Remove `supabase/functions/fare-lookup/` from this repo | Cost | **done** |

## C · Yahoo order emails (Yahoo!ショッピング)
**Mailbox:** @yahoo.co.jp. **Set up 2026-11-03:** the person confirmed mangaonkaraniket@gmail.com on the Yahoo! JAPAN ID and made it the メインメールアドレス, so Yahoo! JAPAN email reaches the Gmail that Akatsuki's script reads. The MUFG debit emails were considered and dropped: they miss konbini payments and have no items.

| Item | Owner | Status |
|---|---|---|
| Cost: `yahoo_shopping` source name, store and payment shown on the card | Cost | **done in v70** |
| Pass `COST-ASK-yahoo-orders.md` to Akatsuki | person | **done** |
| At the next Yahoo order, check the email on the checkout page (ご注文者情報) shows the Gmail | person | open |
| First real Yahoo order email in Gmail (or one forwarded from yahoo.co.jp), for Akatsuki to build from | person | open |
| Akatsuki feasibility reply: yes; no change to Cost's side | Akatsuki | **done** (2026-11-03) |
| Hub R060: `yahoo_shopping` in `purchase_source`; `store`, `payment`, `pay_by` on `purchase.detected` | Akatsuki | **live** (vocab checked 2026-11-03) |
| Akatsuki: parser for order and cancellation emails, dry run first | Akatsuki | waits on the first real email |
| Unpaid konbini order with no cancellation email: Cost could raise "did you pay?" after `pay_by` | Cost | only if Yahoo sends no cancellation email |

## D · Housekeeping
| Item | Status |
|---|---|
| Merge the branch (3 note commits + this review; no app change) | open |
| `migrations/README.md` statuses (005, 011–014, 017 all applied) | **done in v67** |
| Remove `supabase/functions/places-nearby/` (Cost's old Google Places function: not deployed, nothing calls it; the app uses the hub's `akatsuki-places-nearby`) | **done** (2026-11-03) |
| Wishlist card says "cap ¥2,036": rename to "wishlist price … (date)" so an old sale price is not read as agreed | **done in v68** |

## E · Parked ideas
- Stops, scoped 2026-11-03 (stops are only detected while the app is open; a web app cannot track in the background):
  - **Auto-save a spot once named: done in v71.** Logging an unknown stop with a shop shows a ticked "Remember this spot for <shop> (<area>)". On Log it is saved as a confirmed hub spot (`manual`, 100 m) in the shop's one area, so the next visit comes up named. If the shop is in no area or in several, nothing is saved and the card says why. It is also skipped when another spot is within 35 m, because the hub would merge into it.
  - Where a stop falls in the day: a per-day timeline in the Stops panel (stops in time order, logged ones with shop and amount). Small–medium, no migration. Next, if wanted.
  - Reminder right after leaving: vibrate plus a card (and a notification if allowed) when an unlogged stop ends. Only works while the app is open; low value.
- Convert the app to Vite: low priority by the person's choice.

---

# v67 · fixes for bugs 1–4 (2026-11-03)

| # | Fix | Checked |
|---|---|---|
| 1 | `orderFlagged()`: a `logged` reply **plus a cancel row** counts as flagged, so the warning no longer depends on the flag write landing. `orderIsOpen` and the card use it; "OK, got it" writes `seen` as before. | Logged order + cancel row with no `flagged` reply → warning shown; OK acks `flagged` + `seen`. |
| 2 | `orderItems()` takes each line's index **before** dropping nameless lines; `expFor` looks lines up by index, not array position; the row divider uses the row number. | `[A, (no name), B]` per item → lines 0 and 2 in the reply and in `order_lines`. |
| 3 | `log`, `confirmSkip`, `seenFlag` and `dismissPast` reset `busy` in `finally`. A v61 bare-id mark is turned into the `{ids, lines}` shape instead of crashing. | Reply throws → card stays usable, message shown, retry reuses the expense (no second insert). Mark `{seq: 777}` → no insert, reply carries 777. |
| 4 | `saveOrderLines` dispatches `ORDER_LINES_EVT` only on success. | Failing upsert with history open → 1 attempt, no loop. |

Cache bumped to `cm-shell-v67`. Not changed: performance items 6–7 and the shop-picker duplicate (5).

---

# v68 · items 5–7 and the wishlist "cap" label (2026-11-03)

| # | Change | Checked |
|---|---|---|
| 5 | **The review's fix was wrong.** Live `cost_management_shops` has `shops_user_name_region_uniq (user_id, lower(name), region)`, so a second "Aeon" under Pharmacy cannot exist; matching on name + category would only turn the tick into a "Shop exists" error. The name-only match stays. What changed: the message now says where the shop lives ("Aeon already exists under Supermarket — ticked it (change its category in Shops)"), says "already in <area>" instead of ticking a shop that is already linked, and the picker shows a ticked shop even when the category scope would hide it. | Parse check only; not run in a browser (see below). |
| 6 | `matchTokens` caches tokens per name; `matchesFor` is cached per name until the open cards change; `orderDupOf` looks up a per-amount index (`expensesByAmount`, memoised on the expense list) instead of scanning every expense. Keystrokes in a price or shop box no longer re-tokenise or re-scan. | Same results by construction (same predicates, cached). |
| 7 | `orderInbox` reads cancellations plus a **payload-free** list of detected rows (`seq, src_addr, reply->>status, reply->>seen`), then fetches full rows only for candidates: no reply, or not `seen` and `flagged`, or `logged` with a cancellation (keeps the v67 bug-1 fix). The app's `orderIsOpen` still decides. `onOrder` from the consume loop goes through `reloadOrdersSoon`: one read 600 ms after the batch goes quiet, never two at once. | Mock test: rows {unreplied, logged, logged+cancel, flagged, flagged+seen} → returns the unreplied, logged+cancel and flagged rows, 3 reads. Live (SQL): 11 detected rows, 0 candidates, so the inbox is empty as today and the third read is skipped. |
| — | Wishlist cards: "cap ¥X" → "wishlist price ¥X (Oct 12)", the date being when the card was last set (`updated_at`, else `created_at`). Form label "Budget cap" → "Wishlist price"; "Over the cap" → "Above the … wishlist price (date)". The Weekly Focus "sent" list uses the same wording. The DB column stays `budget_cap`. | Parse check. |

Cache bumped to `cm-shell-v68`. **Not run end to end:** this session cannot reach supabase.co over HTTP (proxy 403), so the app was not loaded in a browser and the PostgREST `reply->>status` select was not tried against the live API (it is standard PostgREST syntax). Worth a quick look after deploy: the Requests tab loads and an order card still shows its wishlist match.

---

# v72 · faster opening (2026-11-03)

**Cause:** every open loaded Babel (2.8 MB) and compiled all of `js/app.jsx` (650 KB) in the browser with the `env` + `react` presets. The `env` part, rewriting modern JavaScript for old browsers, was most of the cost, and no browser this app runs on needs it.

**Change:** `js/app-loader.js` replaces `<script type="text/babel">`.
- It fetches `app.jsx` and hashes it.
- **Compiled copy found** for that exact source: it runs at once, and Babel is never downloaded or parsed.
- **Not found** (first open after an update): it loads Babel, compiles with the `react` preset only (JSX), keeps the result in Cache Storage `cm-compiled`, and drops older copies.
- `sw.js` keeps `cm-compiled` across shell versions, and Babel is no longer a blocking `<script>` in `index.html`.
- **Editing is unchanged:** edit `app.jsx` as before; a changed file is recompiled once.

**Measured** (headless Chromium, libraries from npm, Supabase blocked, so up to the sign-in screen):

| | Before | First open after an update | Every later open |
|---|---|---|---|
| Normal CPU | 6.3–6.6 s | 1.2 s | **0.13 s** |
| CPU slowed 4× (≈ mid phone) | 27.3 s | 4.5 s | **0.38 s** |

**Not measured:** the data load after sign-in (6 queries in parallel, expenses in 2 pages of 1000, to the Mumbai region). The app shows "Loading…" until all of it arrives. Next step if opening still feels slow: show the last copy at once and refresh it in the background.
