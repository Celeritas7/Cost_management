-- One physical expense, with a dated return portion of its total amount.
-- NULL / NULL preserves every existing record and its original reporting.
alter table public.cost_management_expenses
  add column if not exists return_date date,
  add column if not exists return_amount integer;
alter table public.cost_management_expenses
  add constraint cost_expense_return_journey_check check (
    (return_date is null and return_amount is null)
    or (
      return_date is not null and return_amount is not null
      and date is not null and return_date >= date
      and category is not null and category = 'Transportation'
      and amount is not null and return_amount > 0 and amount > return_amount
    )
  );
comment on column public.cost_management_expenses.return_date is 'Actual return travel date; NULL for one-way and legacy entries';
comment on column public.cost_management_expenses.return_amount is 'Return portion of amount. Outward fare = amount - return_amount. amount remains the total for the stored record.';
notify pgrst, 'reload schema';
