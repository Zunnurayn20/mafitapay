-- Store native Android biometric public keys separately from WebAuthn
-- credentials. Private keys never leave Android Keystore.
ALTER TABLE public.security_settings
  ADD COLUMN IF NOT EXISTS native_biometric_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.biometric_approvals
  ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'webauthn';

CREATE TABLE IF NOT EXISTS public.native_biometric_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_native_biometric_devices_user_created_at
  ON public.native_biometric_devices(user_id, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.native_biometric_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'approval')),
  challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_native_biometric_challenges_user_purpose_created_at
  ON public.native_biometric_challenges(user_id, purpose, created_at DESC);

ALTER TABLE public.native_biometric_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.native_biometric_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.native_biometric_devices, public.native_biometric_challenges FROM anon, authenticated;
GRANT ALL ON TABLE public.native_biometric_devices, public.native_biometric_challenges TO service_role;
