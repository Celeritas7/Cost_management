-- ═══════════════════════════════════════════════════════════════
-- 018 · HOME-COOKED LUNCHES — lunch accounted for without an expense
--
-- REVIEW-ONLY: this file is intentionally not applied by the app.
-- Apply it manually only after review. It is additive and preserves all
-- existing expense data. One row means that user's lunch on that local
-- calendar date was home-cooked; no amount or expense row is involved.
-- ═══════════════════════════════════════════════════════════════

begin;

create table if not exists public.cost_management_home_cooked_lunches (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lunch_date  date not null,
  created_at  timestamptz not null default now(),
  constraint home_cooked_lunches_user_date_uniq unique (user_id, lunch_date)
);

create index if not exists home_cooked_lunches_user_date_idx
  on public.cost_management_home_cooked_lunches (user_id, lunch_date desc);

alter table public.cost_management_home_cooked_lunches enable row level security;

do $$
declare p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'cost_management_home_cooked_lunches'
  loop
    execute format(
      'drop policy %I on public.cost_management_home_cooked_lunches',
      p.policyname
    );
  end loop;
end $$;

create policy home_cooked_lunches_select_own
  on public.cost_management_home_cooked_lunches
  for select to authenticated
  using (user_id = auth.uid());

create policy home_cooked_lunches_insert_own
  on public.cost_management_home_cooked_lunches
  for insert to authenticated
  with check (user_id = auth.uid());

create policy home_cooked_lunches_delete_own
  on public.cost_management_home_cooked_lunches
  for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.cost_management_home_cooked_lunches from anon;
grant select, insert, delete on public.cost_management_home_cooked_lunches to authenticated;
grant usage, select on sequence public.cost_management_home_cooked_lunches_id_seq to authenticated;

commit;

-- Review checks after applying in a non-production environment:
-- 1. Sign in as user A, insert one date, and verify user A can read/delete it.
-- 2. Sign in as user B and verify user A's row is neither visible nor deletable.
-- 3. Insert the same date twice for one user and verify the unique constraint rejects it.
-- 4. Confirm cost_management_expenses and all spending totals are unchanged.
