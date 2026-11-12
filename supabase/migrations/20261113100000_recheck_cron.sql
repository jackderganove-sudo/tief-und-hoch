-- Nächtliches Nachprüfen von „unchecked“-Antworten (Supabase Cron + pg_net).
-- Läuft täglich 09:15 UTC (10:15/11:15 deutscher Zeit) – kurz nachdem das Gratis-Kontingent
-- von Gemini zurückgesetzt wurde (Mitternacht Pazifikzeit).
-- Das Geheimnis liegt NICHT im Repo: Supabase Vault (Name 'judge_cron_secret') und
-- gleichlautend als Function-Secret CRON_SECRET (siehe README).
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'recheck-unchecked-answers',
  '15 9 * * *',
  $job$
  select net.http_post(
    url := 'https://kifwpibeehllrdqhlqpu.supabase.co/functions/v1/judge-answer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'judge_cron_secret')
    ),
    body := '{"mode":"recheck-batch","limit":30}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
