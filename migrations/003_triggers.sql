-- 003: location triggers move from localStorage to the database.
-- One row per trigger; the full trigger object lives in `data` (jsonb)
-- so the app's camelCase fields round-trip without mapping.
create table if not exists cost_management_triggers (
  id text primary key,
  region text not null default 'JPY',
  is_active boolean not null default true,
  last_fired_date text,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists idx_cm_triggers_region on cost_management_triggers (region);
alter table cost_management_triggers enable row level security;
create policy "anon all" on cost_management_triggers for all using (true) with check (true);
