-- ============================================================
-- Cost Management — Rules + Outstanding inbox migration
-- Run this in Supabase → SQL Editor, then click RUN.
-- Safe to run more than once (uses IF NOT EXISTS).
-- ============================================================

-- 1) Extend the existing recurring table so it can also hold
--    time-window and location (geofence + dwell) trigger config.
--    Existing recurring rows keep working — every new column is nullable.
ALTER TABLE cost_management_recurring
  ADD COLUMN IF NOT EXISTS start_time  text,          -- "HH:MM" window start (null = no time window)
  ADD COLUMN IF NOT EXISTS end_time    text,          -- "HH:MM" window end
  ADD COLUMN IF NOT EXISTS lat         double precision,
  ADD COLUMN IF NOT EXISTS lng         double precision,
  ADD COLUMN IF NOT EXISTS radius_m    integer,        -- geofence radius in metres
  ADD COLUMN IF NOT EXISTS dwell_min   integer DEFAULT 0,  -- minutes you must stay in radius before firing
  ADD COLUMN IF NOT EXISTS conditions  text DEFAULT 'schedule';
  -- conditions: comma list of active triggers for this rule, any of:
  --   'schedule' (uses frequency), 'time' (uses start/end), 'place' (uses lat/lng/radius/dwell)
  -- e.g. 'schedule', 'place', 'schedule,place', 'time,place'

-- 2) Outstanding inbox — one row per occurrence that was owed but not yet logged.
--    The app's reconciler inserts 'pending' rows; you clear them by logging or dismissing.
CREATE TABLE IF NOT EXISTS cost_management_pending (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_id     bigint NOT NULL REFERENCES cost_management_recurring(id) ON DELETE CASCADE,
  due_date    date   NOT NULL,                 -- the period date the expense was owed for (back-stamp target)
  amount      numeric,                          -- null = ask when logging (variable-amount rules)
  status      text   NOT NULL DEFAULT 'pending',  -- 'pending' | 'logged' | 'dismissed'
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  -- one occurrence per rule per due_date (lets the reconciler upsert without duplicating)
  CONSTRAINT cost_management_pending_unique UNIQUE (rule_id, due_date)
);

CREATE INDEX IF NOT EXISTS cost_management_pending_status_idx
  ON cost_management_pending (status, due_date);

-- 3) Access — match whatever the rest of your tables use.
--    If your other tables have Row Level Security ENABLED with policies,
--    uncomment and run this so the app's anon key can read/write the inbox:
--
-- ALTER TABLE cost_management_pending ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY cost_management_pending_all
--   ON cost_management_pending FOR ALL
--   USING (true) WITH CHECK (true);
--
--    If your tables have RLS disabled (anon key writes directly), skip the block above.

-- ============================================================
-- Done. After RUN succeeds, tell me and I'll build the merged
-- Rules tab + Outstanding inbox + the reconciler.
-- ============================================================
