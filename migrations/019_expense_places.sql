-- A place belongs to an individual purchase. Existing expenses remain unlabelled.
alter table public.cost_management_expenses
  add column if not exists place_name text,
  add column if not exists place_id text;
comment on column public.cost_management_expenses.place_name is 'Place or branch label confirmed by the user for this purchase';
comment on column public.cost_management_expenses.place_id is 'Selected Google Place ID for this purchase, if available';
notify pgrst, 'reload schema';
