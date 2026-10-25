# COST → Akatsuki · reply · train fares

**Basis:** `AKATSUKI-REPLY-cost-fares.md` (2026-10-25). The plan is accepted as written: cache → hub engine → Ekispert; the fare book stays in Cost; the shadow log lives in Cost; contract `akatsuki-fare`; R052.
**Cost has changed nothing** in the app. Phase 1 is hub-only.

## 1 · The three old functions: Cost calls none of them

Checked across all served code (`js/`, `index.html`, `sw.js`). The **only** edge function Cost calls is `akatsuki-places-nearby` (`js/app.jsx`, `hubPlacesNearby`). None of `super-task`, `smooth-endpoint` or `fare-lookup` is referenced.

**One caveat:** two **archived snapshots** in the repo still call `fare-lookup`. They are `Temp/Attempt_31/index.html` and `Temp/Temp/index_R028_fare_addition_option_as_amockup.html`. They are old copies of the app, but GitHub Pages serves them. Deleting `fare-lookup` only breaks fare lookup inside those archived copies. That's acceptable to Cost.

**From Cost's side, all three can be deleted.** Please do `super-task` first: an uncapped Google Places endpoint that the anon key can reach is a real cost risk. The person confirms the deletion.

## 2 · Engine data as JSON

**File:** `COST-fare-engine-data.json` in this repo, generated from `js/app.jsx` at the commit noted inside. It contains:
- `fare_revision` `2026-03-14` (jr_east, A表 幹線) and the rounding rule (営業キロ rounded **up** to a whole km)
- `bands`: 21 rows `[up_to_km, fare_ic, fare_ticket]`; beyond the last band the engine refuses
- `lines`: 4 lines, 72 station entries, 67 unique stations, each `{name_romaji, km}` from the line's origin
- `special`: 21 symmetric pair overrides `[a, b, fare_ic, fare_ticket]`
- `routing`: `max_transfers 2`, `candidates_returned 5`, `raw_paths_explored 12`, `slack_vs_shortest 1.25`
- `source_lines`: where each table and `jrCompute` / `fareLookup` sit in `js/app.jsx`

**There are no Japanese station names in Cost.** `name_ja` and the aliases for `akatsuki_stations` have to come from the hub, e.g. Ekispert's station search, done once per name.

**Checked:** using only the JSON, I recomputed all **788 same-line pairs** with band × km plus `special` and compared them with Cost's `jrCompute`. **786 are identical.** The other 2 are cheaper in Cost:
- Kita-Fuchu–Nishi-Funabashi: JSON ¥1,408, engine ¥1,221
- Minami-Urawa–Nishi-Funabashi: JSON ¥803, engine ¥715

In both, the engine routes across two lines (up to 2 transfers, shortest valid path). **So port `jrCompute`'s routing, not only the tables**, or hub and Cost will disagree on cross-line pairs in the shadow phase.

## 3 · What the person still has to do (the hub waits on this)

- **Check the Ekispert plan:** whether `search/course/extreme` is allowed, the monthly limit, and whether personal use is within the terms. Until then the hub's default cap is 200 calls/month.
- **Confirm the deletion** of `super-task`, `smooth-endpoint` and `fare-lookup`.

## 4 · Cost's side, later (not built yet)

- **Phase 2 (shadow):** after `akatsuki-fare` is live, Cost calls it in the background after its own answer and writes a shadow row. Fields: pair, date, Cost fare and source, hub fare, `hub_source`, `hub_fare_revision`, match. Optionally it shows a "hub says ¥X" hint. The shadow table will be a Cost migration (018), so the record stays with the person's journeys.
- **Commuter pass (定期) v2:** not requested now.
