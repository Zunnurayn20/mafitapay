ALTER TABLE public.static_virtual_account_provisioning
  DROP CONSTRAINT IF EXISTS static_virtual_account_provisioning_provider_check;

ALTER TABLE public.static_virtual_account_provisioning
  ADD CONSTRAINT static_virtual_account_provisioning_provider_check
  CHECK (provider IN ('palmpay', 'flutterwave', 'billstack'));
