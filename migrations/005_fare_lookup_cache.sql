-- 005 · Phase A: transit fare lookup cache
-- RLS on from day one (unlike cost_management_pending's launch mistake).
-- The app runs on the anon key with no user auth, so policies are
-- least-privilege by OPERATION: read + validated insert only; no update,
-- no delete (pruning is service_role's job).
create table if not exists public.cost_management_fare_lookup_cache (
  id bigint generated always as identity primary key,
  from_station text not null,
  to_station text not null,
  fare_ic int not null,
  fare_ticket int,
  distance_km numeric,
  route_summary text,
  looked_up_at timestamptz not null default now()
);
create index if not exists idx_fare_cache_route
  on public.cost_management_fare_lookup_cache (from_station, to_station, looked_up_at desc);

alter table public.cost_management_fare_lookup_cache enable row level security;

create policy "fare_cache_read" on public.cost_management_fare_lookup_cache
  for select to anon, authenticated using (true);

create policy "fare_cache_insert" on public.cost_management_fare_lookup_cache
  for insert to anon, authenticated
  with check (
    char_length(from_station) between 1 and 80
    and char_length(to_station) between 1 and 80
    and fare_ic > 0 and fare_ic < 100000
    and (fare_ticket is null or (fare_ticket > 0 and fare_ticket < 100000))
    and looked_up_at <= now() + interval '5 minutes'
  );
-- intentionally NO update/delete policies
