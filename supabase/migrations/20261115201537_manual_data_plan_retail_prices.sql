ALTER TABLE public.pricing_rules
  ADD COLUMN IF NOT EXISTS retail_price_kobo BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pricing_rules_retail_price_kobo_nonnegative'
      AND conrelid = 'public.pricing_rules'::regclass
  ) THEN
    ALTER TABLE public.pricing_rules
      ADD CONSTRAINT pricing_rules_retail_price_kobo_nonnegative
      CHECK (retail_price_kobo IS NULL OR retail_price_kobo >= 0);
  END IF;
END $$;
