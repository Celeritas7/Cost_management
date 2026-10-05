# COST → Akatsuki · R018 step 1b · reply

**Build:** v49 (`cm-shell-v49`; the client changes for 1b are in the same build)
**Commit:** not pushed yet. Base `d68bf414a64501fd58169b364b98023fd707ba92`. **▶ user:** after you push, fill in the sha here.

## 1 · CORS
- Shop Capture is back on `supabase.functions.invoke("akatsuki-places-nearby", { body: { lat, lng, force } })`. The `x-akatsuki-app` header goes out as normal.
- A non-2xx answer (`capped` / 429) is read from `error.context`, and the hub's `reason` is shown.
- The `oldPlacesNearby` fallback is **still in place**. It now runs only when the call never reaches the function. It comes out in the next build, once one tap shows `status`.

## 2 · New contract (named parameters)
| site | call now |
|---|---|
| New area | `akatsuki_area_add(p_label, p_lat, p_lng, p_radius_m: 500, p_country: <currency>, p_app: 'cost')`, then `akatsuki_anchor_add(…, p_source: 'manual', p_radius_m: 500)` when the area has coordinates |
| Add spot | `akatsuki_anchor_add(…, p_entity_ref, 'manual', p_radius_m: <picked>)`. One call; the extra `anchor_edit` is gone. |
| Learned spot | `akatsuki_anchor_add(…, shop entity_ref, 'auto', p_radius_m: 200)` |
| Rename / change region | `akatsuki_area_edit(p_id, { label?, region? }, 'cost')`. Only changed keys are sent. |
| Delete area | `akatsuki_area_edit(p_id, { retire: true }, 'cost')`. Cost then removes its own `shop_locations` rows for that area, as the old cascade did, so those shops show under "No area yet". |
| Merge | Links move in `shop_locations`; each spot moves with `anchor_edit { area_id }`; the source is retired with `area_edit { retire: true }` |
| Keep / Drop / radius / × | `akatsuki_anchor_edit(p_id, { confirmed } \| { radius_m } \| { retire: true }, 'cost')` |

`AK115` is now handled and shown as "That area is no longer in the hub".

## 3 · Corrected 014 (full text)

`migrations/014_hub_ids_place_id.sql`:
- `area_id` **stays uuid**.
- Drops only the FK to `cost_management_areas`, found by its target table rather than its name.
- Adds `cost_management_shops.place_id text` with a partial index.
- Every statement is re-runnable. Nothing is deleted.

The migrations README now says that the live ids are uuid and that the reconstructed 009/010 (bigint) are wrong on this point.

```sql
begin;

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

alter table public.cost_management_shops add column if not exists place_id text;
create index if not exists shops_user_place_idx
  on public.cost_management_shops (user_id, place_id) where place_id is not null;

commit;
```

## 4 · place_id
First pick wins: the client only fills `place_id` where it is still null. Moving it to the branch level (`entity_ref.place_id`) is left for later, as agreed.

## One real tap
**▶ user:** paste the console line `[capture] hub places {status, cached, calls, n, place_id}` here.
