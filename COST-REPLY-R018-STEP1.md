# COST → Akatsuki · R018 step 1 · areas + Google from the hub (G2 + G3)

**Build:** v49 (`sw.js` → `cm-shell-v49`)
**Commit:** none yet. Base is `main` `d68bf414a64501fd58169b364b98023fd707ba92`, plus the uncommitted v48 ticket-fare edits and this step. The sha follows after push.
**Deleted:** nothing. `cost_management_areas`, `cost_management_area_points`, `cost_management_places_cache`, `cost_management_places_usage` and the `places-nearby` function are untouched. Cost no longer reads or writes any of them.

**Not verified live.** I can't sign in to the app or the database from here. The G2 and G3 answers below describe what the code does. The checks still to run are marked **▶ user**.

---

## G2 · Areas + anchors

**Reads now come from the hub.** All four readers use `akatsuki_cost_areas` and `akatsuki_cost_area_points`:
- the Shop Areas panel
- the Add screen's area ranking
- the pins that name visits and Shop Capture
- the Settings "learned spots" badge

**"This pin is that shop" now uses `shop_name`**, not `label`. If the area holds exactly one linked shop, that shop is used; that rule is Cost's own, from `shop_locations`.

**Shop Areas panel shows the hub list:** yes, in code. **▶ user:** open Settings → Shops → Areas and confirm you see 9 areas and 11 spots.

**Write sites:**

| site | before | now |
|---|---|---|
| New area (`createArea`, was L3520–3521) | insert into areas + one 500 m spot | `akatsuki_area_add(name, lat, lng, 500, 'cost')`, then `akatsuki_anchor_add(id, lat, lng, name, null, 'manual', 'cost')` + `anchor_edit {radius_m: 500}` |
| Add spot (`addSpotHere`, was L3589) | insert spot | `akatsuki_anchor_add(…, label, entity_ref, 'manual', 'cost')` + `anchor_edit {radius_m}`. `entity_ref = {"app":"cost","kind":"shop","name":label}` when the label is exactly one of my shops, else `null` |
| Learned spot (`learnSpot`, was L2729) | insert spot `auto`, unconfirmed | `akatsuki_anchor_add(area, lat, lng, shop, entity_ref(shop), 'auto', 'cost')`. I do **not** send `confirmed: false`; I rely on the hub treating `auto` as unconfirmed. If the hub doesn't, tell me. A follow-up edit could demote an existing anchor that the 30 m rule merged into. |
| Keep / Drop / radius / × (`patchSpot`, was L3595) | update / delete | `akatsuki_anchor_edit(id, {confirmed:true} \| {radius_m} \| {retire:true}, 'cost')` |
| Merge (`mergeInto`, was L3557) | move spots, delete source area | Shop links move in `shop_locations` (the source area's links are removed, as the old cascade did). Spots move with `anchor_edit {area_id}`. **The emptied source area stays**, because there is no RPC to delete an area. |

**Errors:** `AK102`, `AK114` and `42501` are shown in plain words and never retried. Areas were online-only before and still are; there is no outbox for them.

**Gaps in the contract.** These need hub RPCs before Cost can drop the old behaviour:
1. **There is no area edit or delete.** Rename, change region and Delete area now show "moves to Akatsuki — not available until the hub adds it". Save with no changes just closes the editor.
2. **`akatsuki_area_add` has no region.** New areas will come back with `region` null, show in every currency profile, and carry the "set region" badge, which can't be cleared (see 1).
3. **`akatsuki_anchor_add` has no radius**, so I send a second `anchor_edit` call. A `p_radius_m` parameter would make it one call.
4. **I assumed the parameter names `p_app` and `p_patch`** for the third argument of `area_add`/`anchor_add` and the second argument of `anchor_edit`. The brief gives them positionally only. They are defined in one place (`hubRpc` helpers near `areaFix`), so correcting them is a one-line change.

**Area ids are not uuids.** The brief says the hub's text ids are "your old uuids". They were `bigint identity` (009), so the hub ids should be `"1"`, `"2"`, …. Cost converts every area id to a string on read, so comparisons work either way. **However, `shop_locations.area_id` is still `bigint` with an FK to `cost_management_areas`**, which means:
- Links to the 9 copied areas keep working: numeric strings cast cleanly.
- **Linking a shop to an area created in the hub fails** on the FK, or on the type if hub ids aren't numeric.
- Fix: `migrations/014_hub_ids_place_id.sql` turns `area_id` into text and drops that FK. No rows change. **▶ user:** run it.

---

## G3 · Google Places

- `ShopCaptureView` now calls `invoke("akatsuki-places-nearby", { body: { lat, lng, force } })`. A non-2xx body, such as the 429 for `capped`, is read from `error.context`, and the hub's `reason` is shown.
- **Order:** my pinned shops first (free, local) → hub. `hit` or `cached` shows as "remembered · free"; `fetched` shows as "Google · 1 lookup". "Search Google again" sends `force: true`.
- **Removed:** the client cap, the counter, `cm_places_cache` and `cm_places_cfg`. The local copies are cleared on first load. The Settings → Triggers "Google lookups" card is gone. `syncPull` and the one-time seed no longer touch `_places_cache` or `_places_usage`.
- **Candidate mapping:** `name → name`, `types → place_types` (still feeds the category guess), `distance_m → distance_m`. `place_id` is kept on the pick.
- **`place_id` on the shop:** after the expense saves, the code runs `update cost_management_shops set place_id = … where region, name, category match and place_id is null`.
  - It only does this if the name wasn't edited, and the first pick wins.
  - **This needs 014.** Until then it logs a console warning and the expense still saves.
  - Caveat: one Cost shop such as セブン covers many branches, so one `place_id` per shop row records just one branch.
- **One real tap:** **▶ user.** Smart → Shop Capture → "Find shops near me", somewhere with no pinned shop. The console prints `[capture] hub places {status, cached, calls, n, place_id}`, which answers all three questions (status, number of candidates, whether `place_id` arrived).

---

---

## ⚠️ G3 blocker: `akatsuki-places-nearby` fails its CORS preflight

Tested from a browser origin on Oct 5:

| request | result |
|---|---|
| `POST /functions/v1/places-nearby` (Cost's old function) with `Authorization`, `apikey`, `Content-Type` | **200**, candidates returned |
| `POST /functions/v1/akatsuki-places-nearby` with the same headers | **blocked**: `TypeError: Failed to fetch`. The preflight is rejected and the function never runs. |
| `POST /functions/v1/akatsuki-places-nearby` with no headers (no preflight) | 401 `UNAUTHORIZED_NO_AUTH_HEADER`. So the function is deployed and reachable. |

**Hub fix:** answer `OPTIONS` with status 200 *before* any auth or body parsing, and send these headers on every response, including OPTIONS and errors:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type, x-akatsuki-app`
- `Access-Control-Allow-Methods: POST, OPTIONS`

`x-akatsuki-app` is in the list because every Akatsuki app's supabase client sends it, so `functions.invoke` needs it allowed. That missing header is also why v48's own call failed.

**Cost's side for now:**
- Cost calls the hub with plain `fetch` and does not send `x-akatsuki-app`.
- When the hub call fails, Shop Capture falls back to the old `places-nearby` and labels the results "Google · old lookup (hub blocked)". That path has no cap, no counter and no `place_id`.
- The fallback is marked TEMPORARY in the code (`oldPlacesNearby`). I remove it as soon as one hub tap shows `status` in the console.

## Hub vs Cost area list

I can't query the database from here. Paste this into the SQL editor; empty results mean the lists match:

```sql
-- areas: missing on either side, or any field differs
select coalesce(c.id::text, h.id) id, c.name cost_name, h.name hub_name,
       c.lat c_lat, h.lat h_lat, c.lng c_lng, h.lng h_lng, c.radius_m c_r, h.radius_m h_r, c.region c_reg, h.region h_reg
from cost_management_areas c full join akatsuki_cost_areas h on h.id = c.id::text
where c.id is null or h.id is null or c.name is distinct from h.name or c.lat is distinct from h.lat
   or c.lng is distinct from h.lng or c.radius_m is distinct from h.radius_m or c.region is distinct from h.region;

-- points: same check, plus where the hub's shop_name differs from the label-equals-shop rule Cost used
select coalesce(c.id::text, h.id) id, c.label, h.label hub_label, h.shop_name, c.confirmed, h.confirmed hub_conf,
       c.area_id::text c_area, h.area_id h_area, c.radius_m, h.radius_m hub_r
from cost_management_area_points c full join akatsuki_cost_area_points h on h.id = c.id::text
where c.id is null or h.id is null or c.area_id::text is distinct from h.area_id or c.radius_m is distinct from h.radius_m
   or c.confirmed is distinct from h.confirmed or c.label is distinct from h.label
   or h.shop_name is distinct from (select s.name from cost_management_shops s where s.name = c.label limit 1);
```

---

## Files

- `js/app.jsx`: the readers, the 5 write paths, Shop Capture, removal of the places budget, `syncPull`/seed.
- `sw.js`: v49.
- `migrations/014_hub_ids_place_id.sql` (new) and `migrations/README.md`.

## Rollback

Re-deploy v48. The old tables and the old function are still in place.
