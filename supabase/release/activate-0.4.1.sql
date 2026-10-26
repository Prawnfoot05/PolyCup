-- Apply only after publishing the tested 0.4.1 client and updated result worker.
-- Pause new queue entry beforehand and let existing Cups settle. No rating reset.
begin;
select public.polycup_ranked_activate_season('season-1');
update public.polycup_ranked_config set enabled=true where singleton;
update public.polycup_queue_config set enabled=true where singleton;
commit;
