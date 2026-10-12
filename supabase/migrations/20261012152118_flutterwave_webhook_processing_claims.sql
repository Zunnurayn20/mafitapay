ALTER TABLE public.provider_events
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
