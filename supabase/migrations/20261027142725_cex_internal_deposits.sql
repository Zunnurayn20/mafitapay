-- Off-chain exchange deposits are separate from chain-scanned deposits.
-- Only the server role (DATABASE_URL) may read or write these records.
ALTER TABLE public.crypto_deposit_events
  ALTER COLUMN address_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'onchain',
  ADD COLUMN IF NOT EXISTS cex_exchange TEXT,
  ADD COLUMN IF NOT EXISTS cex_uid TEXT,
  ADD COLUMN IF NOT EXISTS cex_tx_id TEXT,
  ADD COLUMN IF NOT EXISTS memo TEXT;

CREATE TABLE IF NOT EXISTS public.cex_deposit_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  exchange TEXT NOT NULL,
  external_uid TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_verification', 'verified', 'disabled')),
  challenge_amount NUMERIC(20, 8) NOT NULL,
  challenge_asset TEXT NOT NULL DEFAULT 'USDT' CHECK (challenge_asset = 'USDT'),
  challenge_expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, exchange),
  UNIQUE (exchange, external_uid),
  CHECK (status <> 'verified' OR verified_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_cex_deposit_accounts_user_status
  ON public.cex_deposit_accounts (user_id, status);

CREATE TABLE IF NOT EXISTS public.cex_inbound_transfers (
  id TEXT PRIMARY KEY,
  exchange TEXT NOT NULL,
  external_transfer_id TEXT NOT NULL,
  sender_uid TEXT NOT NULL,
  receiver_uid TEXT NOT NULL,
  asset_symbol TEXT NOT NULL,
  amount NUMERIC(30, 12) NOT NULL CHECK (amount > 0),
  provider_status TEXT NOT NULL,
  attribution_status TEXT NOT NULL CHECK (attribution_status IN ('unmatched', 'pending_verification', 'processing', 'credited', 'ignored')),
  credited_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  crypto_event_id TEXT REFERENCES public.crypto_deposit_events(id) ON DELETE SET NULL,
  transaction_id TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exchange, external_transfer_id)
);

CREATE INDEX IF NOT EXISTS idx_cex_inbound_transfers_status_received
  ON public.cex_inbound_transfers (attribution_status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_cex_inbound_transfers_sender
  ON public.cex_inbound_transfers (exchange, sender_uid, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_cex_inbound_transfers_user
  ON public.cex_inbound_transfers (credited_user_id, received_at DESC);

CREATE TABLE IF NOT EXISTS public.cex_deposit_sync_state (
  exchange TEXT PRIMARY KEY,
  window_start_ms BIGINT NOT NULL,
  window_end_ms BIGINT NOT NULL,
  next_cursor TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cex_deposit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cex_inbound_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cex_deposit_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cex_deposit_accounts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cex_inbound_transfers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cex_deposit_sync_state FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_crypto_deposit_events_cex
  ON public.crypto_deposit_events (cex_exchange, cex_tx_id)
  WHERE source <> 'onchain';
