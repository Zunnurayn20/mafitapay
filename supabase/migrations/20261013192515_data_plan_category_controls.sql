CREATE TABLE IF NOT EXISTS disabled_data_plan_categories (
  category_type TEXT NOT NULL CHECK (category_type IN ('network', 'plan_type')),
  category_key TEXT NOT NULL,
  reason TEXT,
  disabled_at TEXT NOT NULL,
  disabled_by TEXT,
  PRIMARY KEY (category_type, category_key)
);
