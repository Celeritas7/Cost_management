-- ============================================
-- Cost Management — Categories Table Migration
-- ============================================
-- ⚠ DO NOT RUN THIS AGAINST THE LIVE DATABASE.
--
-- This file is history, not a task. It is migration 000 of a set that
-- must be applied IN ORDER (000 → 008) to rebuild the schema from an
-- empty project. The live database is already past 008.
--
-- Running it now fails at the seed, because 008 replaced the global
-- UNIQUE(name) with a per-user unique index on (user_id, lower(name)),
-- so `on conflict (name)` matches no constraint. That error is 008
-- working correctly.
-- ============================================

-- 1. Create the categories table
CREATE TABLE IF NOT EXISTS cost_management_categories (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  icon        TEXT DEFAULT '📦',
  color       TEXT DEFAULT '#8b5cf6',
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 2. Index for sorting
CREATE INDEX IF NOT EXISTS idx_categories_sort ON cost_management_categories (sort_order, name);

-- 3. Enable Row Level Security
ALTER TABLE cost_management_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read categories"   ON cost_management_categories FOR SELECT USING (true);
CREATE POLICY "Public insert categories" ON cost_management_categories FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update categories" ON cost_management_categories FOR UPDATE USING (true);
-- Note: No DELETE policy - deletion should be done via SQL manually for safety

-- 4. Insert default categories
-- `where not exists` rather than `on conflict`: the uniqueness on this
-- table changes in 008 (global name → per-user name), and a seed that
-- names a specific constraint breaks the moment that happens. This
-- form is correct under either scheme.
insert into cost_management_categories (name, icon, color, sort_order)
select v.name, v.icon, v.color, v.sort_order
from (values
  ('Supermarket',       '🛒', '#2563eb', 1),
  ('Convenience',       '🏪', '#f59e0b', 2),
  ('Asian shop',        '🌏', '#10b981', 3),
  ('Restaurant',        '🍜', '#ef4444', 4),
  ('Daily need stuffs', '🧹', '#ec4899', 5),
  ('Other',             '📦', '#8b5cf6', 99)
) as v(name, icon, color, sort_order)
where not exists (
  select 1 from cost_management_categories c where lower(c.name) = lower(v.name)
);

-- 5. Verify
SELECT * FROM cost_management_categories ORDER BY sort_order;
