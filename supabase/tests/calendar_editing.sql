-- Run after fixture.sql and all migrations in the disposable test database.
begin;

do $$
declare
  test_user uuid := '00000000-0000-0000-0000-000000000001';
  other_user uuid := '00000000-0000-0000-0000-000000000002';
  first_id bigint;
  open_id bigint;
begin
  insert into public.work_sessions (user_id, started_at, ended_at)
    values (test_user, '2030-04-01 08:00+02', '2030-04-01 12:00+02')
    returning id into first_id;

  begin
    insert into public.work_sessions (user_id, started_at, ended_at)
      values (test_user, '2030-04-01 11:00+02', '2030-04-01 13:00+02');
    raise exception 'TEST FAILED: overlapping session accepted';
  exception when exclusion_violation then null;
  end;

  begin
    insert into public.work_sessions (user_id, started_at, ended_at)
      values (test_user, '2030-04-01 14:00+02', '2030-04-01 13:00+02');
    raise exception 'TEST FAILED: departure before arrival accepted';
  exception when check_violation then null;
  end;

  -- Touching sessions and other users' sessions do not overlap.
  insert into public.work_sessions (user_id, started_at, ended_at)
    values (test_user, '2030-04-01 12:00+02', '2030-04-01 13:00+02');
  insert into public.work_sessions (user_id, started_at, ended_at)
    values (other_user, '2030-04-01 09:00+02', '2030-04-01 10:00+02');

  insert into public.work_sessions (user_id, started_at)
    values (test_user, '2030-04-01 14:00+02')
    returning id into open_id;

  begin
    -- An open session extends indefinitely.
    insert into public.work_sessions (user_id, started_at, ended_at)
      values (test_user, '2030-04-01 15:00+02', '2030-04-01 16:00+02');
    raise exception 'TEST FAILED: session overlapping an open session accepted';
  exception when exclusion_violation then null;
  end;

  begin
    update public.work_sessions set ended_at = '2030-04-01 14:30+02' where id = first_id;
    raise exception 'TEST FAILED: overlapping update accepted';
  exception when exclusion_violation then null;
  end;

  -- An earlier completed session is allowed while another one is open.
  insert into public.work_sessions (user_id, started_at, ended_at)
    values (test_user, '2030-03-31 08:00+02', '2030-03-31 16:00+02');
  update public.work_sessions set started_at = '2030-04-01 13:30+02' where id = open_id;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
set local role authenticated;

delete from public.work_sessions where user_id = '00000000-0000-0000-0000-000000000001';
reset role;
do $$
begin
  if (select count(*) from public.work_sessions
      where user_id = '00000000-0000-0000-0000-000000000001') <> 4 then
    raise exception 'TEST FAILED: user deleted another user''s sessions';
  end if;
end;
$$;

set local role authenticated;
delete from public.work_sessions where user_id = '00000000-0000-0000-0000-000000000002';
reset role;
do $$
begin
  if exists (select 1 from public.work_sessions
             where user_id = '00000000-0000-0000-0000-000000000002') then
    raise exception 'TEST FAILED: user could not delete own session';
  end if;
end;
$$;

rollback;
\echo 'calendar_editing tests passed'
