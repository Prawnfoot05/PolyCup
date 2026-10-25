-- Explicit future deployment step. Never invoked by a local build.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists pgcrypto with schema extensions;
select cron.schedule('polycup-input-dispatch','30 seconds','set statement_timeout = ''10s''; set lock_timeout = ''2s''; select public.polycup_input_dispatch_tick();');
select cron.schedule('polycup-input-cleanup','27 3 * * *', $$select public.polycup_input_prune();delete from cron.job_run_details where end_time<now()-interval '7 days' and jobid in(select jobid from cron.job where jobname in('polycup-input-dispatch','polycup-input-cleanup'));$$);
commit;
