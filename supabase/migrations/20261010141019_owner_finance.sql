CREATE TABLE IF NOT EXISTS public.owner_finance_entries (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('income', 'expense')),
  category TEXT NOT NULL,
  amount_ngn NUMERIC(14, 2) NOT NULL CHECK (amount_ngn > 0),
  description TEXT NOT NULL,
  counterparty TEXT,
  reference TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at TIMESTAMPTZ,
  voided_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  void_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_owner_finance_entries_occurred_at
  ON public.owner_finance_entries(occurred_at DESC)
  WHERE voided_at IS NULL;

ALTER TABLE public.owner_finance_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.owner_finance_entries FROM PUBLIC, anon, authenticated;
