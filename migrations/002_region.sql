-- 002: region profiles — every expense, shop and recurring rule belongs to a
-- region (its currency code). Existing rows are tagged 'JPY' (Japan).
alter table cost_management_expenses  add column if not exists region text not null default 'JPY';
alter table cost_management_shops     add column if not exists region text not null default 'JPY';
alter table cost_management_recurring add column if not exists region text not null default 'JPY';
create index if not exists idx_cm_expenses_region on cost_management_expenses (region);
