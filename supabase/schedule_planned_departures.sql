-- Enable Supabase Cron (pg_cron) first, then run as the database owner.
-- Scheduling the same named job again updates it rather than duplicating it.
select cron.schedule(
  'attendance-planned-departures',
  '* * * * *',
  'select public.finish_due_planned_departures();'
);
