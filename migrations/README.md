# Migrations — read this first

These files are **version control, not a to-do list.**

Your live database is already at **008**. Everything here has been applied
except `005_fare_lookup_cache.sql`. Do not run them again to "catch up" —
re-running an applied migration either errors or duplicates data.

## When you would actually run these

Only when rebuilding the schema from an empty Supabase project. Then run them
**in numeric order**, 000 → 008, no skipping. Each assumes the previous one
succeeded.

`004` does not exist. Leave the gap — renumbering a migration that has already
run somewhere is how you end up applying it twice.

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

## Why 000 fails if you run it now

`008` replaced the global `UNIQUE(name)` on categories with a per-user unique
index on `(user_id, lower(name))`. The original seed said
`on conflict (name) do nothing`, which needs that global constraint to exist.
It no longer does, so Postgres raises `42P10: there is no unique or exclusion
constraint matching the ON CONFLICT specification`.

That error is the new security model working. The seed has since been rewritten
as `where not exists (...)`, which is correct under either scheme — but on the
live database the rows are already there, so there is still nothing to run.

## The one migration you could still run

`005_fare_lookup_cache.sql` creates the 90-day fare memo table. The app works
without it — `fareLookup()` falls through to the fare book and the JR engine.
If you do apply it, re-run `008` afterwards so the new table gets its `user_id`
column and owner-scoped policy; `008` is written to skip tables that do not
exist and to pick them up on a later run.
