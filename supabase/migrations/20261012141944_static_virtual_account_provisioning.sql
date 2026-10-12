CREATE TABLE IF NOT EXISTS public.static_virtual_account_provisioning (
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('palmpay', 'flutterwave')),
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('creating', 'ready', 'failed', 'uncertain')),
  virtual_account JSONB,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider),
  CHECK ((status = 'ready') = (virtual_account IS NOT NULL))
);

ALTER TABLE public.static_virtual_account_provisioning ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.static_virtual_account_provisioning FROM PUBLIC, anon, authenticated;
