# Return journeys

In Smart entry → Fare calc, Round trip enables a return date and fare. A blank return fare uses the current outward fare. The return can be on the same day or any later valid date. Both journeys are saved in one expense row.

For an already saved one-way transportation route such as A → B, use Add return journey in History or Add return in the calendar day details. Confirm the return date/fare and Save. This updates that expense, rather than inserting another one. Edit from either leg to change either fare/date or remove the return using Include return journey. Deleting a round trip explicitly confirms that both fares will be removed.

Existing records are left unchanged, including older round trips represented as A → B → A. This release does not merge or delete any old separately recorded return journeys.

## Storage and reporting contract

- `shop` is the outward route, `date` is the outward date.
- `amount` is the total of both fares. For a one-way record it is simply the outward fare.
- `return_date` and `return_amount` are both NULL for one-way/legacy records.
- For a round trip, outward fare = `amount - return_amount`.
- `return_amount` is positive; the outward portion is positive; return date is on or after outward date; category must be Transportation. Migration 020 enforces these rules without changing ownership policies.
- `expenseLegs` expands records only in memory, before date/year/currency/category filters and calculations. Calendar, charts, yearly/monthly totals, route totals and recurring-gap checks use the dated fares. Neither in-memory leg creates a database row.
- History groups matching legs before pagination. A filter showing only the return year or route includes only that fare and labels the partial result. The edit/delete handlers always resolve the underlying record ID.
- Offline writes retain the same one-row update and all return fields. The expense overlay is applied before expansion, so there is no double-counting of queued updates.
- External SQL consumers must also split the fares by date for period reporting; grouping stored `amount` solely by `date` assigns the full trip to the outward date. All-time SUM(amount) remains correct.

## Verification

With Node and Playwright installed, run:

```
node tests/return-journeys.cjs
node tests/return-fare-calculator.cjs
node tests/expense-places.cjs
```

The tests exercise actual JSX handlers with lightweight hook/render mocks and no live expense writes. They cover cross-year reporting, grouped and partially filtered history, one-row insert/update, independent dates/fares, same-day defaults, validation, duplicate-tap prevention, editing/deleting from either leg, return removal, failed-save retry and offline overlays. Browser visual testing requires Chromium to be able to create its process socket.
