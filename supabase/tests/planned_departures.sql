begin;

do $$
declare
  u uuid := '00000000-0000-0000-0000-000000000002';
  start_time timestamptz := date_trunc('day', statement_timestamp() at time zone 'Europe/Prague')
    at time zone 'Europe/Prague';
  plan timestamptz := start_time + interval '23 hours';
  sid bigint;
begin
  -- Use tomorrow so this test works at any hour of the day.
  start_time := start_time + interval '1 day';
  plan := start_time + interval '8 hours';
  insert into public.work_sessions(user_id, started_at, planned_departure_at)
    values (u, start_time, plan) returning id into sid;
  perform public.finish_due_planned_departures();
  if (select ended_at is not null from public.work_sessions where id = sid) then
    raise exception 'TEST FAILED: session ended early';
  end if;

  begin
    update public.work_sessions set planned_departure_at = start_time where id = sid;
    raise exception 'TEST FAILED: plan before or equal to arrival accepted';
  exception when check_violation then null;
  end;
  begin
    update public.work_sessions set planned_departure_at = start_time + interval '2 days' where id = sid;
    raise exception 'TEST FAILED: different Prague day accepted';
  exception when check_violation then null;
  end;
  begin
    update public.work_sessions set lunch_started_at = plan where id = sid;
    raise exception 'TEST FAILED: lunch at planned departure accepted';
  exception when check_violation then null;
  end;
  update public.work_sessions set ended_at = start_time + interval '7 hours' where id = sid;
  perform public.finish_due_planned_departures();
  if (select ended_at <> start_time + interval '7 hours' from public.work_sessions where id = sid) then
    raise exception 'TEST FAILED: automatic completion overwrote manual departure';
  end if;
  if (select planned_departure_at is not null from public.work_sessions where id = sid) then
    raise exception 'TEST FAILED: manual departure did not clear plan';
  end if;
  delete from public.work_sessions where id = sid;
  insert into public.work_sessions(user_id, started_at)
    values (u, start_time) returning id into sid;
  perform public.finish_due_planned_departures();
  if (select ended_at is not null from public.work_sessions where id = sid) then
    raise exception 'TEST FAILED: session without a plan was automatically closed';
  end if;
  delete from public.work_sessions where id = sid;
  begin
    insert into public.work_sessions(user_id, started_at, planned_departure_at)
      values (u, statement_timestamp() - interval '2 minutes', statement_timestamp() - interval '1 minute');
    raise exception 'TEST FAILED: past plan accepted';
  exception when check_violation then null;
  end;
end;
$$;

-- Simulate time passing without sleeping or changing the database clock.
alter table public.work_sessions disable trigger validate_planned_departure;
insert into public.work_sessions(user_id, started_at, planned_departure_at)
values
  ('00000000-0000-0000-0000-000000000001', now() - interval '2 hours', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000000002', now() - interval '2 hours', now() - interval '1 hour');
alter table public.work_sessions enable trigger validate_planned_departure;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select public.finish_my_planned_departure();
do $$
begin
  begin
    perform public.finish_due_planned_departures();
    raise exception 'TEST FAILED: user can run global finalizer';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
do $$
begin
  if exists (select 1 from public.work_sessions
             where user_id = '00000000-0000-0000-0000-000000000002' and ended_at is null) then
    raise exception 'TEST FAILED: own due session not closed';
  end if;
  if not exists (select 1 from public.work_sessions
                 where user_id = '00000000-0000-0000-0000-000000000001' and ended_at is null) then
    raise exception 'TEST FAILED: own RPC closed another user session';
  end if;
end;
$$;
select public.finish_due_planned_departures();
do $$
begin
  if exists (select 1 from public.work_sessions
             where ended_at is null or planned_departure_at is not null
                or ended_at <> transaction_timestamp() - interval '1 hour') then
    raise exception 'TEST FAILED: scheduler did not persist exact planned departure';
  end if;
end;
$$;
rollback;
\echo 'planned_departures tests passed'
