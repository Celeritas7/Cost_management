-- ═══════════════════════════════════════════════════════════════
-- 013 · REQUESTS — things to buy, sent to Weekly Focus via Akatsuki
--
-- Cost owns this table. Weekly Focus never writes it; it sees each
-- row as a hub event (request.created / request.changed) and answers
-- on the reply. The app applies those answers here.
--
-- id is made by the client (uuid as text) so a request written with
-- no signal keeps the same identity in the outbox, the hub and WF.
-- changed_by records who caused the last change: 'wf' rows came from
-- a WF reply and are never re-published (no echo).
-- ═══════════════════════════════════════════════════════════════

begin;

create table if not exists cost_management_requests (
  id              text primary key,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item            text not null check (length(btrim(item)) > 0),
  quantity        numeric not null default 1 check (quantity > 0),
  unit            text,
  source          text not null check (source in ('food_dept','sukkiri','own')),
  needed_by       date,
  budget_cap      numeric check (budget_cap is null or budget_cap >= 0),
  currency        text,
  preferred_shop  text,
  notes           text,
  status          text not null default 'open' check (status in ('open','done','cancelled')),
  expense_id      bigint,               -- set when closed by logging an expense
  changed_by      text not null default 'cost' check (changed_by in ('cost','wf')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists requests_user_status_idx on cost_management_requests (user_id, status);

do $$
declare p record;
begin
  alter table cost_management_requests enable row level security;
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'cost_management_requests' loop
    execute format('drop policy %I on cost_management_requests', p.policyname);
  end loop;
  create policy cost_management_requests_own on cost_management_requests
    for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
end $$;

commit;
