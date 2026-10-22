-- Invoke the protected crypto deposit scanner every two minutes. The job secret
-- is provisioned separately in Supabase Vault and is never stored in migration SQL.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $migration$
DECLARE
  existing_job_id BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'mafitapay_job_secret'
      AND decrypted_secret <> ''
  ) THEN
    RAISE EXCEPTION 'Supabase Vault secret mafitapay_job_secret must be configured before scheduling crypto deposit sync';
  END IF;

  SELECT jobid
    INTO existing_job_id
    FROM cron.job
   WHERE jobname = 'mafitapay-crypto-deposit-sync';

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'mafitapay-crypto-deposit-sync',
    '*/2 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://mafitapay.com/api/jobs/crypto-deposits/sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-mafitapay-job-secret', (
            SELECT decrypted_secret
              FROM vault.decrypted_secrets
             WHERE name = 'mafitapay_job_secret'
             ORDER BY created_at DESC
             LIMIT 1
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    $cron$
  );
END
$migration$;
