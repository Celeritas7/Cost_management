-- ============================================
-- Cost Management — Categories Table Migration
-- ============================================
-- Run this in Supabase SQL Editor

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
INSERT INTO cost_management_categories (name, icon, color, sort_order) VALUES
  ('Supermarket',       '🛒', '#2563eb', 1),
  ('Convenience',       '🏪', '#f59e0b', 2),
  ('Asian shop',        '🌏', '#10b981', 3),
  ('Restaurant',        '🍜', '#ef4444', 4),
  ('Daily need stuffs', '🧹', '#ec4899', 5),
  ('Other',             '📦', '#8b5cf6', 99)
ON CONFLICT (name) DO NOTHING;

-- 5. Verify
SELECT * FROM cost_management_categories ORDER BY sort_order;
