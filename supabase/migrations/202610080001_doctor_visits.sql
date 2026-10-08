begin;

alter table public.work_days add column doctor_from time, add column doctor_to time;

-- Replace the original enum/duration checks, preserving unrelated constraints.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.work_days'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) like '%type% = ANY%'
        or pg_get_constraintdef(oid) like '%duration_minutes%')
  loop
    execute format('alter table public.work_days drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.work_days add constraint work_days_type_check
  check (type in ('holiday', 'vacation', 'sick_day', 'comp_time', 'mandatory_vacation', 'doctor'));
alter table public.work_days add constraint work_days_duration_check
  check (duration_minutes is null or
    (duration_minutes > 0 and (type = 'doctor' or duration_minutes % 15 = 0)));
alter table public.work_days add constraint work_days_doctor_times_check check (
  (type = 'doctor' and doctor_from is not null and doctor_to is not null
    and doctor_to > doctor_from and doctor_to < time '24:00'
    and extract(second from doctor_from) = 0 and extract(second from doctor_to) = 0
    and duration_minutes = extract(epoch from (doctor_to - doctor_from)) / 60
    and extract(isodow from date) <= 5)
  or (type <> 'doctor' and doctor_from is null and doctor_to is null)
);

create function public.validate_doctor_visit()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.type <> 'doctor' then return new; end if;
  perform 1 from public.profiles where id = new.user_id for update;
  if exists (
    select 1 from public.work_days
    where user_id = new.user_id and date = new.date and type = 'doctor'
      and id <> new.id and doctor_from < new.doctor_to and new.doctor_from < doctor_to
  ) then
    raise exception 'Doctor visits must not overlap' using errcode = '23P01';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_doctor_visit() from public, anon, authenticated;
create trigger validate_doctor_visit before insert or update on public.work_days
  for each row execute function public.validate_doctor_visit();

commit;
