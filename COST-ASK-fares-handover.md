# COST → Akatsuki · handover · train fares

**Ask:** take over train-fare lookup as a hub service, the same way Akatsuki took over Google Places (`akatsuki-places-nearby`). Reply with a plan and answers to the questions below before building.

**The person's rule:** Cost keeps its own fare engine until Akatsuki has proven it can do the job. Nothing is removed from Cost during this handover. Removal is a separate decision that the person makes after the comparison below.

## What Cost does today

`fareLookup()` (`js/app.jsx`), first answer wins:

1. **Fare book**: `cost_management_fare_book`, the person's own confirmed fares.
   - Columns: `pair_a, pair_b, pair_key, fare_ic, fare_ticket, operator, origin, verified, hit_count, notes`.
   - **5 rows, 1 verified**; origins are `manual` and `imported`.
   - An unverified row is cross-checked against the engine and flagged when they differ.
2. **Lookup cache**: `cost_management_fare_lookup_cache`, 90 days. Rows older than the **2026-03-14** fare revision are ignored. **0 rows; effectively unused.**
3. **Engine** (`jrCompute`), entirely offline:
   - Fare = JR East 幹線 band table × published 営業キロ. Bands are effective 2026-03-14; that revision merged 電車特定区間 and 山手線内 into 幹線. Kilometres are rounded up before reading the table.
   - **Covers 4 lines, 72 station entries:** Musashino, Keihin-Tohoku, Chuo-Sobu (local), Sobu Rapid. Station names are romaji, e.g. `Minami-Urawa`.
   - Routes with up to 2 transfers, up to 5 candidates.
   - `JR_SPECIAL` holds pair overrides where the published fare differs from the band.
   - **Not covered:** Tokyo Metro, Toei, private railways, other JR lines. A miss asks the person to type the fare, and a typed fare can go into the fare book.
4. **Usage:** about 26 transport expenses in the last 90 days.

**Unused code:** `supabase/functions/fare-lookup` calls Ekispert (駅すぱあと) `search/course/extreme` and returns `{fare_ic, fare_ticket, distance_km, route_summary, transfers, via_stations}`. Nothing in Cost calls it, and no `EKISPERT_API_KEY` is set as far as Cost knows. **It also has a bug:** `stationCode()` calls `ekispert("station", { name })` without the key, so station lookup fails. Fix it if you reuse it.

## What Cost would like from the hub

**A fare service, shaped like `akatsuki-places-nearby`:**
- An edge function, e.g. `akatsuki-fare`, called with the person's JWT.
- **Input:** `{ from, to, date? }`. Station names as Cost has them (romaji); Japanese names welcome too.
- **Output:** `{ fare_ic, fare_ticket, distance_km, route_summary, transfers, via, source: 'hub_cache'|'ekispert'|'hub_engine'|…, looked_up_at, fare_revision }`. Or `{ status: 'miss' | 'capped' | 'error', reason }`.
- **One shared cache** keyed by the normalised station pair plus fare revision, in `akatsuki_cache` or your own table. Then one lookup serves every app and device.
- **A monthly call counter and cap** for any paid or limited source, as with Places. The Ekispert key lives only on the hub.
- **Station-name normalisation:** romaji ↔ Japanese ↔ the source's station codes. Cost will keep sending romaji.
- **Coverage beyond Cost's 4 lines:** at least Tokyo Metro and Toei, plus JR East beyond Tokyo if the source allows.

**Other apps:** Travel Plan (`trip.segment`) and Calendar could use the same service. Tell me if that changes the contract.

## Handover phases (Cost's proposal)

| Phase | Hub | Cost |
|---|---|---|
| **1 · Build** | Builds `akatsuki-fare`, the cache, the cap and station mapping. | No change. |
| **2 · Shadow** | Answers every call. | Still answers from its own stack and **shows its own fare**. It also asks the hub and records both answers (pair, Cost's fare and source, the hub's fare and source, match yes/no). The person sees nothing new except, optionally, a "hub says ¥X" hint when they differ. |
| **3 · Hub first** | Primary source. | Calls the hub first. **Falls back to its own stack** when offline, on a miss, cap or error, or on a timeout of about 3 s. The fare book still wins over everything, because it holds what the person actually paid. |
| **4 · Retire (person's decision)** | — | Only after the person agrees. Even then, Cost keeps the offline engine for no-signal logging unless the person says otherwise. |

**"Mastered" means**, as a proposal for the person to confirm before phase 3 and again before phase 4:
- 30+ shadow lookups;
- every hub/Cost disagreement explained (a hub or Cost bug, or a real fare difference);
- the hub covers every pair Cost covers, plus the pairs Cost had to type by hand;
- no hub outage that would have blocked logging.

## Questions for Akatsuki

1. **Source:** Ekispert (key, plan, call limits), another API, or a hub-side engine (Cost's band tables and kilometrage moved to the hub as shared data)? A mix, e.g. hub engine first and Ekispert for misses?
2. **Fare book:** should the person's confirmed fares move to the hub (shared, so other apps see real paid fares), or stay in Cost with Cost preferring them? Cost leans towards keeping them in Cost until phase 4.
3. **Station identity:** what canonical station id will the hub use, and can it accept Cost's romaji names as they are?
4. **Fare revisions:** how will the hub know a fare revision happened (like 2026-03-14) and invalidate its cache?
5. **IC vs ticket, and passes:** will both fares always be returned? Is commuter-pass (定期) coverage in scope, so a covered segment prices at ¥0?
6. **The shadow log:** where should it live? In Cost (Cost writes it) or on the hub (the hub logs Cost's answer alongside its own)?
7. **Contract details:** migration number, function name and error shapes, as with the places reply.
8. **Anything that blocks this,** or a simpler route.

**Reply format:** numbered answers, the final function contract, and what Cost should call in each phase.
