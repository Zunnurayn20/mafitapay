-- Make the reward schema reproducible for PostgreSQL and add one durable claim
-- per rule/source user. This key represents one eligible event per user for a
-- rule (the inviter's reward is keyed by the referred user).
CREATE TABLE IF NOT EXISTS public.reward_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  audience TEXT NOT NULL,
  amount_ngn NUMERIC NOT NULL CHECK (amount_ngn > 0),
  requires_referral BIGINT NOT NULL DEFAULT 0,
  allowed_transaction_types JSONB,
  excluded_transaction_types JSONB,
  daily_payout_cap_ngn NUMERIC,
  manual_approval_required BIGINT NOT NULL DEFAULT 0,
  is_active BIGINT NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE public.reward_rules ADD COLUMN IF NOT EXISTS daily_payout_cap_ngn NUMERIC;
ALTER TABLE public.reward_rules ADD COLUMN IF NOT EXISTS manual_approval_required BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.reward_award_requests (
  id TEXT PRIMARY KEY,
  reward_rule_id TEXT NOT NULL,
  reward_rule_name TEXT NOT NULL,
  reward_kind TEXT NOT NULL,
  reward_type TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  audience TEXT NOT NULL,
  beneficiary_user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  trigger_transaction_id TEXT REFERENCES public.transactions(id) ON DELETE SET NULL,
  amount_ngn NUMERIC NOT NULL CHECK (amount_ngn > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  status_reason TEXT,
  reviewed_at TEXT,
  reviewed_by_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reward_award_requests_status_created_at
  ON public.reward_award_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_award_requests_rule_source
  ON public.reward_award_requests(reward_rule_id, source_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.reward_award_claims (
  id TEXT PRIMARY KEY,
  reward_rule_id TEXT NOT NULL,
  source_user_id TEXT NOT NULL,
  beneficiary_user_id TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  trigger_transaction_id TEXT,
  reward_type TEXT NOT NULL CHECK (reward_type IN ('referral_bonus', 'reward_bonus')),
  amount_ngn NUMERIC NOT NULL CHECK (amount_ngn > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'rejected', 'capped')),
  reward_request_id TEXT,
  reward_transaction_id TEXT UNIQUE,
  status_reason TEXT,
  paid_at TEXT,
  reviewed_at TEXT,
  reviewed_by_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT reward_award_claims_rule_source_unique UNIQUE (reward_rule_id, source_user_id)
);

CREATE INDEX IF NOT EXISTS idx_reward_award_claims_status_paid_at
  ON public.reward_award_claims(status, paid_at DESC);

ALTER TABLE public.reward_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_award_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_award_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reward_rules, public.reward_award_requests, public.reward_award_claims FROM anon, authenticated;
GRANT ALL ON TABLE public.reward_rules, public.reward_award_requests, public.reward_award_claims TO service_role;

-- Repair requests whose status was committed before their wallet transaction,
-- and mark pending requests as approved when the corresponding credit exists.
UPDATE public.reward_award_requests AS request
SET status = 'pending',
    status_reason = 'Recovered for review: approval was recorded without a reward credit.',
    reviewed_at = NULL,
    reviewed_by_user_id = NULL,
    updated_at = NOW()::TEXT
WHERE request.status = 'approved'
  AND NOT EXISTS (
    SELECT 1
    FROM public.transactions AS txn
    WHERE txn.user_id = request.beneficiary_user_id
      AND txn.type = request.reward_type
      AND txn.status = 'success'
      AND txn.metadata::JSONB ->> 'rewardRuleId' = request.reward_rule_id
      AND txn.metadata::JSONB ->> 'sourceUserId' = request.source_user_id
  );

UPDATE public.reward_award_requests AS request
SET status = 'approved',
    status_reason = COALESCE(request.status_reason, 'Credit was already recorded.'),
    reviewed_at = COALESCE(request.reviewed_at, request.updated_at),
    updated_at = NOW()::TEXT
WHERE request.status = 'pending'
  AND EXISTS (
    SELECT 1
    FROM public.transactions AS txn
    WHERE txn.user_id = request.beneficiary_user_id
      AND txn.type = request.reward_type
      AND txn.status = 'success'
      AND txn.metadata::JSONB ->> 'rewardRuleId' = request.reward_rule_id
      AND txn.metadata::JSONB ->> 'sourceUserId' = request.source_user_id
  );

-- Collapse any duplicate pending review rows created by older concurrent calls.
WITH ranked_pending AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY reward_rule_id, source_user_id
    ORDER BY created_at ASC, id ASC
  ) AS position
  FROM public.reward_award_requests
  WHERE status = 'pending'
)
UPDATE public.reward_award_requests AS request
SET status = 'rejected',
    status_reason = 'Duplicate request for the same reward trigger; the original request is retained.',
    reviewed_at = NOW()::TEXT,
    updated_at = NOW()::TEXT
FROM ranked_pending
WHERE request.id = ranked_pending.id AND ranked_pending.position > 1;

-- Backfill paid claims first, preserving a stable earliest transaction when
-- historical duplicates already exist.
INSERT INTO public.reward_award_claims (
  id, reward_rule_id, source_user_id, beneficiary_user_id, trigger_event,
  trigger_transaction_id, reward_type, amount_ngn, status,
  reward_transaction_id, paid_at, created_at, updated_at
)
SELECT DISTINCT ON (txn.metadata::JSONB ->> 'rewardRuleId', txn.metadata::JSONB ->> 'sourceUserId')
  'reward_claim_' || MD5((txn.metadata::JSONB ->> 'rewardRuleId') || ':' || (txn.metadata::JSONB ->> 'sourceUserId')),
  txn.metadata::JSONB ->> 'rewardRuleId',
  txn.metadata::JSONB ->> 'sourceUserId',
  txn.user_id,
  COALESCE(txn.metadata::JSONB ->> 'rewardEvent', 'first_successful_transaction'),
  txn.metadata::JSONB ->> 'triggerTransactionId',
  txn.type,
  txn.amount,
  'paid',
  txn.id,
  txn.created_at,
  txn.created_at,
  NOW()::TEXT
FROM public.transactions AS txn
WHERE txn.type IN ('referral_bonus', 'reward_bonus')
  AND txn.status = 'success'
  AND txn.metadata IS NOT NULL
  AND NULLIF(txn.metadata::JSONB ->> 'rewardRuleId', '') IS NOT NULL
  AND NULLIF(txn.metadata::JSONB ->> 'sourceUserId', '') IS NOT NULL
ORDER BY txn.metadata::JSONB ->> 'rewardRuleId',
         txn.metadata::JSONB ->> 'sourceUserId',
         txn.created_at ASC,
         txn.id ASC
ON CONFLICT (reward_rule_id, source_user_id) DO NOTHING;

-- Backfill manual requests not already represented by a paid claim.
INSERT INTO public.reward_award_claims (
  id, reward_rule_id, source_user_id, beneficiary_user_id, trigger_event,
  trigger_transaction_id, reward_type, amount_ngn, status,
  reward_request_id, status_reason, reviewed_at, reviewed_by_user_id,
  paid_at, created_at, updated_at
)
SELECT DISTINCT ON (request.reward_rule_id, request.source_user_id)
  'reward_claim_' || MD5(request.reward_rule_id || ':' || request.source_user_id),
  request.reward_rule_id,
  request.source_user_id,
  request.beneficiary_user_id,
  request.trigger_event,
  request.trigger_transaction_id,
  request.reward_type,
  request.amount_ngn,
  CASE WHEN request.status = 'rejected' AND request.status_reason ILIKE '%cap reached%' THEN 'capped'
       WHEN request.status = 'approved' THEN 'paid'
       ELSE request.status END,
  request.id,
  request.status_reason,
  request.reviewed_at,
  request.reviewed_by_user_id,
  CASE WHEN request.status = 'approved' THEN COALESCE(request.reviewed_at, request.updated_at) ELSE NULL END,
  request.created_at,
  request.updated_at
FROM public.reward_award_requests AS request
ORDER BY request.reward_rule_id, request.source_user_id, request.created_at ASC, request.id ASC
ON CONFLICT (reward_rule_id, source_user_id) DO NOTHING;
