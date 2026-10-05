-- ═══════════════════════════════════════════════════════════════
-- 014 · HUB AREA LINKS + SHOP PLACE ID — R018 step 1 (G2, G3)
--
-- 1. cost_management_shop_locations.area_id: drop its FK to
--    cost_management_areas. Areas now live in Akatsuki; an area
--    created in the hub never exists in Cost's table, so the FK would
--    reject every link to it. The column stays uuid: the live probe
--    (Oct 5) shows it is uuid, and hub area ids are uuid-format text,
--    which casts cleanly. No rows change.
-- 2. cost_management_shops.place_id: the Google place the user picked
--    in Shop Capture. Nullable; first pick wins. Cost domain.
--
-- Deletes nothing. cost_management_areas / _area_points are left as
-- they are. Every statement is re-runnable.
--
-- Note: 009/010 in this folder were reconstructed and say bigint. The
-- live ids are uuid. The live schema wins (see README).
-- Numbering: Phase 15c and Phase 20 move to 015 / 016.
-- ═══════════════════════════════════════════════════════════════

begin;

-- 1 · drop every FK from shop_locations.area_id to cost_management_areas, whatever its name
do $$
declare c text;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.cost_management_shop_locations'::regclass
      and con.contype = 'f'
      and con.confrelid = 'public.cost_management_areas'::regclass
  loop
    execute format('alter table public.cost_management_shop_locations drop constraint if exists %I', c);
  end loop;
end $$;

-- 2 · place_id on shops
alter table public.cost_management_shops add column if not exists place_id text;
create index if not exists shops_user_place_idx
  on public.cost_management_shops (user_id, place_id) where place_id is not null;

commit;

-- Checks (read-only):
-- FK gone (expect 0 rows):
--   select conname from pg_constraint
--   where conrelid = 'public.cost_management_shop_locations'::regclass and contype = 'f'
--     and confrelid = 'public.cost_management_areas'::regclass;
-- Every link points at a live hub area (expect 0 rows):
--   select l.* from public.cost_management_shop_locations l
--   left join public.akatsuki_cost_areas h on h.id = l.area_id::text where h.id is null;
