ALTER TABLE public.crypto_pairs
  ADD COLUMN IF NOT EXISTS buy_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sell_enabled BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE public.crypto_pairs
SET buy_enabled = FALSE,
    sell_enabled = FALSE
WHERE is_active = 0
  AND buy_enabled = TRUE
  AND sell_enabled = TRUE;

CREATE TABLE IF NOT EXISTS public.crypto_trading_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  buys_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sells_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.crypto_trading_settings (id, buys_enabled, sells_enabled)
VALUES (1, TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.crypto_trading_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crypto_trading_settings FROM PUBLIC, anon, authenticated;
