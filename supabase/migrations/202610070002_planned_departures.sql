begin;

alter table public.work_sessions add column planned_departure_at timestamptz;
create index due_planned_departures on public.work_sessions (planned_departure_at)
  where ended_at is null and planned_departure_at is not null;

create function public.validate_planned_departure()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ended_at is not null then
    new.planned_departure_at := null;
    return new;
  end if;

  if new.planned_departure_at is not null then
    if new.planned_departure_at <= new.started_at
       or (new.lunch_started_at is not null
           and new.planned_departure_at <= new.lunch_started_at)
       or (new.started_at at time zone 'Europe/Prague')::date <>
          (new.planned_departure_at at time zone 'Europe/Prague')::date then
      raise exception 'Invalid planned departure: must follow arrival and lunch on the arrival day'
        using errcode = '23514';
    end if;

    if tg_op = 'INSERT' then
      if new.planned_departure_at <= statement_timestamp() then
        raise exception 'Planned departure must be in the future' using errcode = '23514';
      end if;
    elsif new.planned_departure_at is distinct from old.planned_departure_at
          and new.planned_departure_at <= statement_timestamp() then
      raise exception 'Planned departure must be in the future' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_planned_departure
  before insert or update on public.work_sessions
  for each row execute function public.validate_planned_departure();

-- Called by the database-owner cron job, never by an untrusted client.
create function public.finish_due_planned_departures()
returns void
language sql security definer
set search_path = ''
as $$
  update public.work_sessions
  set ended_at = planned_departure_at
  where ended_at is null and planned_departure_at <= statement_timestamp();
$$;
revoke all on function public.finish_due_planned_departures() from public, anon, authenticated;

-- Also close the caller's due session immediately when the app is opened.
create function public.finish_my_planned_departure()
returns void
language sql security definer
set search_path = ''
as $$
  update public.work_sessions
  set ended_at = planned_departure_at
  where user_id = auth.uid()
    and ended_at is null and planned_departure_at <= statement_timestamp();
$$;
revoke all on function public.finish_my_planned_departure() from public, anon;
grant execute on function public.finish_my_planned_departure() to authenticated;

commit;
