-- Keep historical sender identifiers so masked OKX contacts can never be
-- reassigned to a different MafitaPay user after unlinking an exchange account.
CREATE TABLE IF NOT EXISTS public.cex_deposit_account_identifiers (
  exchange TEXT NOT NULL,
  external_identifier TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (exchange, external_identifier)
);

INSERT INTO public.cex_deposit_account_identifiers (exchange, external_identifier, user_id, created_at)
SELECT exchange, external_uid, user_id, created_at
FROM public.cex_deposit_accounts
ON CONFLICT (exchange, external_identifier) DO NOTHING;

ALTER TABLE public.cex_deposit_account_identifiers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cex_deposit_account_identifiers FROM PUBLIC, anon, authenticated;
