begin;

-- Users can delete their own work sessions (calendar and history editing).
create policy "Users can delete their own work sessions" on public.work_sessions
  for delete to authenticated using (user_id = auth.uid());

-- Work sessions of one user must not overlap. An open session (ended_at is
-- null) extends indefinitely. Existing overlapping data is not rewritten;
-- the check runs only when a session is created or its times change.
create function public.validate_session_overlap()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.ended_at is not null and new.ended_at <= new.started_at then
    raise exception 'Departure must be after arrival' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE'
     and old.started_at = new.started_at
     and old.ended_at is not distinct from new.ended_at
     and old.user_id = new.user_id then
    return new;
  end if;

  -- Serialize session time changes per user so concurrent requests cannot both pass.
  perform pg_catalog.pg_advisory_xact_lock(
    20261007, pg_catalog.hashtext(new.user_id::text)
  );

  if exists (
    select 1
    from public.work_sessions
    where user_id = new.user_id
      and id <> new.id
      and started_at < coalesce(new.ended_at, 'infinity'::timestamptz)
      and new.started_at < coalesce(ended_at, 'infinity'::timestamptz)
  ) then
    raise exception 'Work sessions must not overlap' using errcode = '23P01';
  end if;

  return new;
end;
$$;
revoke all on function public.validate_session_overlap() from public, anon, authenticated;

create trigger validate_session_overlap
  before insert or update on public.work_sessions
  for each row execute function public.validate_session_overlap();

commit;
