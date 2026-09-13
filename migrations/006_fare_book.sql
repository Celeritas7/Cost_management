-- ═══════════════════════════════════════════════════════════════
-- FARE BOOK — your own fare table. Ground truth for transit fares.
--
-- Why this exists: Ekispert's free plan serves station/line master data
-- only (no route search, no fares); the Standard plan is corporate-only.
-- Fares themselves are public (operators publish tariffs) but there is no
-- free national machine-readable fare API. Since a personal commute covers
-- ~20 station pairs, a self-owned table beats any API: offline, free,
-- never expires, and correct by construction once verified.
--
-- Pair normalisation: fares are symmetric, so every row is stored with
-- (pair_a, pair_b) sorted alphabetically and a generated pair_key. A→B and
-- B→A therefore hit the SAME row — enter a fare once, both directions know it.
--
-- Non-additive fares: riding A→B→C on one operator is usually cheaper than
-- fare(A,B) + fare(B,C). A row is just a station pair, so a *direct* A→C
-- fare can be recorded alongside its legs; the app prefers the direct row
-- over the sum of legs when one exists.
-- ═══════════════════════════════════════════════════════════════

create table if not exists cost_management_fare_book (
  id           bigserial primary key,
  pair_a       text not null,
  pair_b       text not null,
  pair_key     text generated always as (pair_a || '|' || pair_b) stored,
  fare_ic      integer not null check (fare_ic > 0),
  fare_ticket  integer check (fare_ticket is null or fare_ticket > 0),
  operator     text default '',
  -- 'manual'   typed while logging a journey
  -- 'imported' CSV / paste import
  -- 'api'      returned by the fare-lookup edge function
  origin       text not null default 'manual',
  -- false until you have actually seen this fare charged / on a fare chart.
  -- Unverified fares still work, they are just marked in the UI so the
  -- audit list is a shrinking to-do rather than a wall of every row.
  verified     boolean not null default false,
  -- number of times the charged amount matched this row. Rises on each
  -- confirm; a high count is a strong signal the fare is right.
  hit_count    integer not null default 0,
  notes        text default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Collation is explicit and deliberate: the app sorts pairs in JS, which
  -- compares UTF-16 code units. The database default collation (en_US.UTF-8)
  -- disagrees with that on case and punctuation ('-' is ignored at the primary
  -- level, lowercase sorts before uppercase), so a pair the app considers
  -- sorted could fail this check and the insert would be rejected. "C" is
  -- byte order, which matches JS.
  constraint fare_book_sorted check (pair_a collate "C" <= pair_b collate "C")
);

create unique index if not exists fare_book_pair_uniq on cost_management_fare_book (pair_key);
create index if not exists fare_book_unverified on cost_management_fare_book (verified) where verified = false;

-- keep updated_at honest so stale rows surface after a fare revision
create or replace function cost_management_fare_book_touch() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists fare_book_touch on cost_management_fare_book;
create trigger fare_book_touch before update on cost_management_fare_book
  for each row execute function cost_management_fare_book_touch();

alter table cost_management_fare_book enable row level security;
drop policy if exists fare_book_all on cost_management_fare_book;
create policy fare_book_all on cost_management_fare_book for all using (true) with check (true);
