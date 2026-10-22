ALTER TABLE public.crypto_trading_settings
  ADD COLUMN IF NOT EXISTS minimum_sweep_usd NUMERIC(12, 2) NOT NULL DEFAULT 5;
