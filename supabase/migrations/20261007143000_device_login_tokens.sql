CREATE TABLE IF NOT EXISTS public.device_login_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  previous_token_hash TEXT,
  device_label TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform = 'android'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address TEXT
);

CREATE INDEX IF NOT EXISTS idx_device_login_tokens_user_created_at
  ON public.device_login_tokens(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_device_login_tokens_active_user
  ON public.device_login_tokens(user_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.device_login_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.device_login_tokens FROM PUBLIC, anon, authenticated;
