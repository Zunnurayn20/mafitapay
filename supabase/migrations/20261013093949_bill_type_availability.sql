CREATE TABLE IF NOT EXISTS public.bill_type_settings (
  service_type TEXT PRIMARY KEY CHECK (
    service_type IN ('airtime', 'data', 'electric', 'cable', 'education', 'gas', 'insurance', 'water')
  ),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.bill_type_settings (service_type, is_enabled)
VALUES
  ('airtime', TRUE),
  ('data', TRUE),
  ('electric', TRUE),
  ('cable', TRUE),
  ('education', TRUE),
  ('gas', TRUE),
  ('insurance', TRUE),
  ('water', TRUE)
ON CONFLICT (service_type) DO NOTHING;

ALTER TABLE public.bill_type_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bill_type_settings FROM PUBLIC, anon, authenticated;
