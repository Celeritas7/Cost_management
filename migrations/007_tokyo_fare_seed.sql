-- ═══════════════════════════════════════════════════════════════
-- 007 · TOKYO FARE SEED  (optional — safe to skip or re-run)
--
-- Seeds the fare book from PUBLISHED operator tariffs, not from guesses.
--
-- ─ Why this file is short ─
-- There is no free machine-readable national fare API, and per-pair fares
-- require official operating distances that are not public in bulk. What IS
-- public and stable is each operator's DISTANCE BAND TABLE — a handful of
-- prices per operator. Those are seeded below as a reference table, and the
-- app shows them in Settings → Fare book so filling a real fare is a glance
-- rather than a search.
--
-- Only station pairs confirmed against a post-revision source are inserted
-- as actual fares. Every one lands verified = false: treat them as a head
-- start to check at the gate, not as ground truth.
--
-- ─ Staleness warning ─
-- JR East revised fares on 2026-03-14, its first system-wide revision since
-- 1987 (~7.1% average). The cheaper "電車特定区間" (electric-specific section)
-- and "山手線内" (within the Yamanote loop) categories were ABOLISHED and
-- folded into trunk-line pricing, which raised central Tokyo fares sharply.
-- Any JR fare you find dated before 2026-03-14 is wrong. Metro/Toei were
-- not part of that revision.
-- ═══════════════════════════════════════════════════════════════

-- ── Operator tariff bands (reference, not journey fares) ──────────
create table if not exists cost_management_fare_bands (
  id          bigserial primary key,
  operator    text    not null,
  km_from     numeric not null,
  km_to       numeric,             -- null = open-ended top band
  fare_ic     integer not null,
  fare_ticket integer,
  -- true  = this exact price is published by the operator
  -- false = the band is structural (right shape, price not individually quoted)
  -- An explicit column, not a prose convention: the UI shows a verified/
  -- unverified marker per band, and parsing source_note for that would make a
  -- wording change silently mislabel a fare.
  quoted      boolean not null default false,
  source_note text default '',
  as_of       date    not null,
  unique (operator, km_from)
);

-- re-runnable against a table created by an earlier version of this file
alter table cost_management_fare_bands add column if not exists quoted boolean not null default false;

alter table cost_management_fare_bands enable row level security;
drop policy if exists fare_bands_all on cost_management_fare_bands;
create policy fare_bands_all on cost_management_fare_bands for all using (true) with check (true);

delete from cost_management_fare_bands where operator in ('Tokyo Metro', 'Toei Subway');

-- Tokyo Metro — ticket denominations are published as 180/210/260/300/330
-- (each includes the ¥10 barrier-free charge). IC is charged to the single
-- yen and lands a few yen under the rounded-up paper price.
insert into cost_management_fare_bands (operator, km_from, km_to, fare_ic, fare_ticket, quoted, source_note, as_of) values
  ('Tokyo Metro',  0,  6, 178, 180, true, 'Published ticket denomination; incl. ¥10 barrier-free charge', '2026-09-01'),
  ('Tokyo Metro',  7, 11, 209, 210, true, 'Published ticket denomination', '2026-09-01'),
  ('Tokyo Metro', 12, 19, 252, 260, true, 'Published ticket denomination', '2026-09-01'),
  ('Tokyo Metro', 20, 27, 293, 300, true, 'Published ticket denomination', '2026-09-01'),
  ('Tokyo Metro', 28, null, 324, 330, true, 'Top published denomination', '2026-09-01');

-- Toei Subway — single rides are published as ranging ¥180 to ¥430.
-- Intermediate bands are the long-standing structure; confirm at the gate.
insert into cost_management_fare_bands (operator, km_from, km_to, fare_ic, fare_ticket, quoted, source_note, as_of) values
  ('Toei Subway',  0,  4, 178, 180, true,  'Published minimum', '2026-09-01'),
  ('Toei Subway',  5,  9, 217, 220, false, 'Structure — confirm at gate', '2026-09-01'),
  ('Toei Subway', 10, 15, 283, 290, false, 'Structure — confirm at gate', '2026-09-01'),
  ('Toei Subway', 16, 21, 324, 330, false, 'Structure — confirm at gate', '2026-09-01'),
  ('Toei Subway', 22, 27, 377, 380, false, 'Structure — confirm at gate', '2026-09-01'),
  ('Toei Subway', 28, null, 429, 430, true,  'Published maximum', '2026-09-01');

-- ── Confirmed post-revision JR East pairs ─────────────────────────
-- Sorted (pair_a <= pair_b under C collation) to satisfy the book's
-- constraint. Inserted unverified. ON CONFLICT DO NOTHING so this never
-- overwrites a fare you have already checked yourself.
-- Only figures actually quoted by a post-revision source are given; anything
-- inferred says so in notes, and anything unknown is null rather than guessed.
insert into cost_management_fare_book (pair_a, pair_b, fare_ic, fare_ticket, operator, origin, verified, notes)
values
  ('Ikebukuro', 'Tokyo',   253, 260, 'JR East', 'imported', false, 'Post-2026-03-14 revision (was ¥208 IC)'),
  ('Shibuya',   'Tokyo',   253, 260, 'JR East', 'imported', false, 'Post-2026-03-14 revision; ticket ¥260 quoted (was ¥210). IC inferred: same ¥260 band as Tokyo–Ikebukuro, so same IC fare'),
  ('Hachioji',  'Shinjuku', 616, null, 'JR East', 'imported', false, 'Post-revision specific-section fare, IC ¥616 quoted. Ticket price not quoted — left blank')
on conflict (pair_key) do nothing;
