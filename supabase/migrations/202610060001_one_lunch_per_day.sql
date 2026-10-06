begin;

-- A user may record at most one lunch per Prague calendar day, determined by
-- the session's arrival date. The lunch must lie within the session.
-- Existing duplicate lunches are not rewritten; the app counts only the first.
create function public.validate_session_lunch()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  session_date date;
begin
  if new.lunch_started_at is null then
    return new;
  end if;

  if new.lunch_started_at < new.started_at
     or (new.ended_at is not null and new.lunch_started_at >= new.ended_at) then
    raise exception 'Lunch must be within the work session' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE'
     and old.lunch_started_at is not distinct from new.lunch_started_at
     and old.started_at is not distinct from new.started_at
     and old.user_id = new.user_id then
    return new;
  end if;

  -- Serialize lunch changes per user so concurrent requests cannot both pass.
  perform pg_catalog.pg_advisory_xact_lock(
    20261006, pg_catalog.hashtext(new.user_id::text)
  );

  session_date := (new.started_at at time zone 'Europe/Prague')::date;

  if exists (
    select 1
    from public.work_sessions
    where user_id = new.user_id
      and id <> new.id
      and lunch_started_at is not null
      and (started_at at time zone 'Europe/Prague')::date = session_date
  ) then
    raise exception 'Only one lunch per day is allowed' using errcode = '23514';
  end if;

  return new;
end;
$$;
revoke all on function public.validate_session_lunch() from public, anon, authenticated;

create trigger validate_session_lunch
  before insert or update on public.work_sessions
  for each row execute function public.validate_session_lunch();

commit;
