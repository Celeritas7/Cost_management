# Migrations — read this first

These files are **version control, not a to-do list.**

Your live database is at **010**. Everything here has been applied except
`005_fare_lookup_cache.sql`, `011_stops.sql` and `012_places_budget.sql`.
Do not run applied migrations again to "catch up" — re-running one either
errors or duplicates data.

## Run these two now

`011` and `012` are what make the phone and the laptop share one list. Until
they run, the app still works exactly as before: stops, blocked places, the
lookup counter and the remembered corners stay per device, and the app detects
the missing tables and switches sync off silently (one console note, no errors
in your face).

| File | What it adds | Run it |
| --- | --- | --- |
| `011_stops.sql` | `stops`, `stop_blocks`, `stop_settings` | yes |
| `012_places_budget.sql` | `places_usage`, `places_cache` | yes |

Paste each into Supabase → SQL Editor and run. Both are one transaction and
re-runnable — every object is `if not exists`.

## When you would run the rest

Only when rebuilding the schema from an empty Supabase project. Then run them
**in numeric order**, 000 → 012, no skipping. Each assumes the previous one
succeeded.

`004` does not exist. Leave the gap — renumbering a migration that has already
run somewhere is how you end up applying it twice.

## About 009 and 010

Both were applied to the live database during the multi-anchor work but their
files were never committed, so the folder jumped 008 → 011 while the app was
querying `cost_management_areas` and `cost_management_area_points`. They were
**reconstructed from the app's actual usage on Sept 21 2026** and are written to
be harmless against the live database (`create table if not exists`, policies
dropped and recreated). If you ever rebuild from scratch, they are what makes
000 → 012 a complete history again.

If the reconstruction ever disagrees with the live schema, the live schema wins —
compare with:

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'cost_management_area_points'
order by ordinal_position;
```

## Current state

| File | Applied to live DB |
| --- | --- |
| `000_categories.sql` | yes |
| `001_rules_and_pending.sql` | yes |
| `002_region.sql` | yes |
| `003_triggers.sql` | yes |
| `005_fare_lookup_cache.sql` | **no** — 008 skips the table; safe to run any time |
| `006_fare_book.sql` | yes |
| `007_tokyo_fare_seed.sql` | yes |
| `008_auth_ownership.sql` | yes |
| `009_areas.sql` | yes (file reconstructed after the fact) |
| `010_area_points.sql` | yes (file reconstructed after the fact) |
| `011_stops.sql` | **no — run it** |
| `012_places_budget.sql` | **no — run it** |

## Why 000 fails if you run it now

`008` replaced the global `UNIQUE(name)` on categories with a per-user unique
index on `(user_id, lower(name))`. The original seed said
`on conflict (name) do nothing`, which needs that global constraint to exist.
It no longer does, so Postgres raises `42P10: there is no unique or exclusion
constraint matching the ON CONFLICT specification`.

That error is the new security model working. The seed has since been rewritten
as `where not exists (...)`, which is correct under either scheme — but on the
live database the rows are already there, so there is still nothing to run.

## The one older migration you could still run

`005_fare_lookup_cache.sql` creates the 90-day fare memo table. The app works
without it — `fareLookup()` falls through to the fare book and the JR engine.
If you do apply it, re-run `008` afterwards so the new table gets its `user_id`
column and owner-scoped policy; `008` is written to skip tables that do not
exist and to pick them up on a later run.

## 013 · requests (v30)

`013_requests.sql` — **not yet applied.** Run it once in the Supabase SQL editor. Until then the inbox keeps requests on the device and still publishes to the hub; they are pushed up on the first launch after 013 exists.

## 014 · hub ids + place_id (v49, R018 step 1)

`014_hub_ids_place_id.sql` — **not yet applied.** Drops the FK from `cost_management_shop_locations.area_id` to `cost_management_areas` (areas now live in Akatsuki) and adds `cost_management_shops.place_id`. `area_id` stays uuid. Re-runnable, deletes nothing. Until it runs: links to the copied areas still work; linking a shop to an area *created in the hub* fails on the FK; picked Google place ids are not stored (console warning only). Live ids are **uuid** — 009/010 here say bigint because they were reconstructed; the live schema wins. Phase 15c and Phase 20 move to 015 / 016.
