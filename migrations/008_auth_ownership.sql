-- ═══════════════════════════════════════════════════════════════
-- 008 · AUTH OWNERSHIP — every row belongs to a signed-in user
--
-- Run this in Supabase → SQL Editor (service role, so RLS does not
-- block the backfill). ONE transaction: column, backfill, policies.
-- Chosen deliberately over a two-step rollout because the app is
-- deployed publicly on GitHub Pages with the anon key embedded, so
-- every minute with `using (true)` policies is a minute the whole
-- ledger is world-readable.
--
-- PREREQUISITE — the owner account must already exist in
-- Authentication → Users. Here it does: mangaonkaraniket@gmail.com,
-- uid e91a5f37-e63a-4fd0-8488-4d7a51d56822, already Google-linked.
-- The guard below aborts the whole transaction if the lookup misses,
-- rather than leaving rows owned by nobody and invisible to everyone.
--
-- NOTE — this project holds six accounts with similar addresses. The
-- guard matches ONE exact address on purpose; a LIKE match here could
-- hand the entire ledger to the wrong user.
--
-- Re-runnable: every step is guarded.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── 0 · Resolve the owner, or abort ──────────────────────────────
do $$
declare owner_id uuid;
begin
  select id into owner_id from auth.users where lower(email) = 'mangaonkaraniket@gmail.com';
  if owner_id is null then
    raise exception 'No auth.users row for mangaonkaraniket@gmail.com — create the account in Authentication → Users first, then re-run.';
  end if;
  -- stash for later steps in this transaction
  perform set_config('cm.owner_id', owner_id::text, true);
end $$;

-- ── 1-3 · Column, backfill, constraints — per existing table ────
-- Driven by a loop over to_regclass rather than a flat list of ALTERs,
-- because not every migration has been run on every environment: this
-- project has no cost_management_fare_lookup_cache (005 was never
-- applied), and a hardcoded ALTER on a missing table aborts the whole
-- transaction. Missing tables are skipped and reported; if 005 is run
-- later, re-running 008 picks the table up.
--
-- Within each table the order matters: add the column NULLable, fill
-- every row, and only then demand NOT NULL. Setting the default first
-- would not help — defaults do not apply to rows that already exist.
do $BODY$
declare
  tables text[] := array[
    'cost_management_expenses','cost_management_shops','cost_management_categories',
    'cost_management_tags','cost_management_recurring','cost_management_pending',
    'cost_management_triggers','cost_management_fare_book','cost_management_fare_bands',
    'cost_management_fare_lookup_cache'
  ];
  t text;
  owner uuid := current_setting('cm.owner_id')::uuid;
  n bigint;
  found int := 0;
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      raise notice 'skipping % — table does not exist in this database', t;
      continue;
    end if;
    found := found + 1;

    execute format('alter table %I add column if not exists user_id uuid references auth.users(id) on delete cascade', t);
    execute format('update %I set user_id = $1 where user_id is null', t) using owner;
    execute format('select count(*) from %I where user_id is null', t) into n;
    if n > 0 then
      raise exception 'backfill missed % rows in % — aborting', n, t;
    end if;
    execute format('alter table %I alter column user_id set default auth.uid()', t);
    execute format('alter table %I alter column user_id set not null', t);
  end loop;

  if found = 0 then
    raise exception 'none of the expected cost_management_* tables exist — wrong database?';
  end if;
  raise notice 'owned % of % tables', found, array_length(tables, 1);
end $BODY$;

-- ── 4 · Re-scope uniqueness per owner ────────────────────────────
-- A global unique on a per-user table is a latent bug: a second
-- account could never record a fare pair, category or tag name the
-- first account already has. Cheap to fix now, painful later.
do $BODY$
begin
  if to_regclass('public.cost_management_fare_book') is not null then
    drop index if exists fare_book_pair_uniq;
    create unique index if not exists fare_book_pair_uniq on cost_management_fare_book (user_id, pair_key);
  end if;
  if to_regclass('public.cost_management_fare_bands') is not null then
    alter table cost_management_fare_bands drop constraint if exists cost_management_fare_bands_operator_km_from_key;
    create unique index if not exists fare_bands_operator_km_uniq on cost_management_fare_bands (user_id, operator, km_from);
  end if;
end $BODY$;

-- Categories/tags/shops name uniqueness: only re-scope what actually
-- exists, since these constraints were created ad hoc over time.
do $$
declare r record;
begin
  for r in
    select c.conname, t.relname
    from pg_constraint c join pg_class t on t.oid = c.conrelid
    where c.contype = 'u'
      and t.relname in ('cost_management_categories','cost_management_tags','cost_management_shops')
      and not exists (
        select 1 from unnest(c.conkey) k
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
        where a.attname = 'user_id'
      )
  loop
    execute format('alter table %I drop constraint %I', r.relname, r.conname);
    raise notice 'dropped global unique % on % — recreated per-user below', r.conname, r.relname;
  end loop;
end $$;

create unique index if not exists categories_user_name_uniq on cost_management_categories (user_id, lower(name));
create unique index if not exists tags_user_name_uniq       on cost_management_tags       (user_id, lower(name));

-- ── 5 · Indexes for the read path ────────────────────────────────
-- Every query the app makes is now implicitly filtered by user_id.
create index if not exists expenses_user_date_idx  on cost_management_expenses (user_id, date);
create index if not exists shops_user_idx          on cost_management_shops (user_id);
create index if not exists recurring_user_idx      on cost_management_recurring (user_id);
create index if not exists pending_user_status_idx on cost_management_pending (user_id, status, due_date);
create index if not exists triggers_user_idx       on cost_management_triggers (user_id);

-- ── 6 · Replace the open policies with owner-scoped ones ─────────
-- `using` governs read/update/delete visibility; `with check` governs
-- what may be written. Both are required — `using` alone would let a
-- signed-in user insert rows owned by someone else.
do $$
declare
  tables text[] := array[
    'cost_management_expenses','cost_management_shops','cost_management_categories',
    'cost_management_tags','cost_management_recurring','cost_management_pending',
    'cost_management_triggers','cost_management_fare_book','cost_management_fare_bands',
    'cost_management_fare_lookup_cache'
  ];
  t text;
  p record;
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table %I enable row level security', t);
    -- drop every existing policy on the table, whatever it was named,
    -- so a leftover `using (true)` cannot sit alongside the new one
    -- (policies are OR-ed, so one permissive leftover defeats all of this)
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on %I', p.policyname, t);
    end loop;
    execute format(
      'create policy %I on %I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_own', t);
  end loop;
end $$;

-- ── 7 · Verify before committing ─────────────────────────────────
-- Any orphan here means the backfill missed a table; raising aborts
-- the transaction so nothing half-applied reaches the live app.
do $$
declare n bigint;
begin
  select count(*) into n from cost_management_expenses where user_id is null;
  if n > 0 then raise exception '% expenses still unowned — aborting', n; end if;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════
-- After COMMIT, verify from the app's perspective:
--
--   select count(*) from cost_management_expenses;
--
-- Run as service role (SQL editor) this returns everything. The real
-- test is the app itself: sign in and confirm your history is intact.
-- If the app shows zero rows while this query shows thousands, the
-- signed-in user id differs from the backfilled owner — check
--   select id, email from auth.users;
-- against
--   select distinct user_id from cost_management_expenses;
-- ═══════════════════════════════════════════════════════════════
