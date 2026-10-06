-- Run after fixture.sql and all migrations in the disposable test database.
begin;

do $$
declare
  test_user uuid := '00000000-0000-0000-0000-000000000001';
  first_id bigint;
  second_id bigint;
begin
  insert into public.work_sessions (user_id, started_at, ended_at, lunch_started_at)
    values (test_user, '2030-03-04 07:00+01', '2030-03-04 10:00+01', '2030-03-04 09:00+01')
    returning id into first_id;

  insert into public.work_sessions (user_id, started_at)
    values (test_user, '2030-03-04 11:00+01')
    returning id into second_id;

  begin
    update public.work_sessions set lunch_started_at = '2030-03-04 12:00+01' where id = second_id;
    raise exception 'TEST FAILED: second lunch on the same day accepted';
  exception when check_violation then null;
  end;

  begin
    update public.work_sessions set lunch_started_at = '2030-03-04 06:00+01' where id = first_id;
    raise exception 'TEST FAILED: lunch before arrival accepted';
  exception when check_violation then null;
  end;

  -- Moving the lunch within the same session is allowed.
  update public.work_sessions set lunch_started_at = '2030-03-04 09:30+01' where id = first_id;

  -- A lunch on another Prague day is allowed (23:30 UTC is already the next day in Prague).
  update public.work_sessions set ended_at = '2030-03-04 12:00+01' where id = second_id;
  insert into public.work_sessions (user_id, started_at, lunch_started_at)
    values (test_user, '2030-03-04 23:30+00', '2030-03-05 01:00+01');
end;
$$;

rollback;
\echo 'one_lunch_per_day tests passed'
