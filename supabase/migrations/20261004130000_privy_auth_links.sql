CREATE TABLE IF NOT EXISTS public.privy_auth_links (
  user_id TEXT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  privy_user_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.privy_auth_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.privy_auth_links FROM PUBLIC, anon, authenticated;
