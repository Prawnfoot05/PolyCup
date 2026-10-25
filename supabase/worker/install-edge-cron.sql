-- Explicit deployment step, not a migration. Requires Supabase extensions.
-- Safe to rerun: names are fixed and existing jobs are updated by cron.schedule.
-- Dispatch remains disabled until configured and enabled separately.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists pgcrypto with schema extensions;
-- The extension-owned queue may be readable by other DB roles. The dispatcher
-- stores a short-lived HMAC there, never the reusable Vault secret.
select cron.schedule('polycup-result-dispatch','30 seconds',
  'set statement_timeout = ''10s''; set lock_timeout = ''2s''; select public.polycup_ranked_dispatch_tick();');
-- Scope cleanup to our own scheduler rows. Preserve player history, settlement
-- receipts and raw evidence; evidence retention is a separate launch decision.
select cron.schedule('polycup-result-cron-cleanup','17 3 * * *',
  $$delete from cron.job_run_details where end_time < now()-interval '7 days'
    and jobid in(select jobid from cron.job where jobname in('polycup-result-dispatch','polycup-result-cron-cleanup'));$$);
commit;
