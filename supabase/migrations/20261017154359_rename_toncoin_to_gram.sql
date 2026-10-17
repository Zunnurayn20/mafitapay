UPDATE public.crypto_pairs
SET
  name = 'Gram',
  symbol = 'GRAM',
  updated_at = NOW()
WHERE id = 'TON_TON'
  AND (name IS DISTINCT FROM 'Gram' OR symbol IS DISTINCT FROM 'GRAM');
