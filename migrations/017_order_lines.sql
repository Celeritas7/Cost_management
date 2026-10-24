-- ═══════════════════════════════════════════════════════════════
-- 017 · ORDER LINES — Cost's own record of every line of an online order
--
-- Online orders (Amazon via Akatsuki `mail`) arrive with their items on
-- the hub row, but the hub purges item names 30 days after an order is
-- resolved (R048 akatsuki_purchase_purge). This table keeps each line
-- for good, with what happened to it:
--   logged         → an expense was made (expense_id)
--   paid_by_other  → bought, but someone else paid (note: who / why)
--   skip           → left out for any other reason
-- so months later an order still explains why a line is not in expenses.
--
-- id is made by the client: '<source>:<order_id>:<line_index>', so
-- re-logging an order upserts the same rows instead of adding more.
-- ═══════════════════════════════════════════════════════════════

begin;

create table if not exists cost_management_order_lines (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source      text not null,                       -- 'amazon', later 'rakuten', 'card', …
  order_id    text not null,
  ordered_on  date not null,                       -- the order day in the shop's zone (Asia/Tokyo for JPY)
  line_index  int  not null check (line_index >= 0),
  name        text not null,
  qty         numeric not null default 1,
  price       numeric,                             -- the line's amount (whole line, not per unit)
  currency    text not null default 'JPY',
  status      text not null check (status in ('logged','paid_by_other','skip')),
  note        text,                                -- e.g. who paid
  expense_id  bigint,                              -- set when status = 'logged'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists order_lines_user_order_idx on cost_management_order_lines (user_id, ordered_on desc, order_id);

do $$
declare p record;
begin
  alter table cost_management_order_lines enable row level security;
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'cost_management_order_lines' loop
    execute format('drop policy %I on cost_management_order_lines', p.policyname);
  end loop;
  create policy cost_management_order_lines_own on cost_management_order_lines
    for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
end $$;

revoke all on cost_management_order_lines from anon;

commit;
