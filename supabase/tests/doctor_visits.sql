begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';

insert into public.work_days (user_id, date, type, duration_minutes, doctor_from, doctor_to)
values ('00000000-0000-0000-0000-000000000002', '2026-10-01', 'doctor', 53, '08:30', '09:23');

do $$
declare visit bigint;
begin
  select id into strict visit from public.work_days
    where date = '2026-10-01' and type = 'doctor' and duration_minutes = 53;
  begin
    update public.work_days set duration_minutes = 60 where id = visit;
    raise exception 'Mismatched doctor duration accepted';
  exception when check_violation then null; end;
  begin
    insert into public.work_days (user_id, date, type, duration_minutes, doctor_from, doctor_to)
    values (auth.uid(), '2026-10-01', 'doctor', 53, '09:00', '09:53');
    raise exception 'Overlapping doctor visit accepted';
  exception when exclusion_violation then null; end;
  begin
    insert into public.work_days (user_id, date, type, duration_minutes, doctor_from, doctor_to)
    values (auth.uid(), '2026-10-03', 'doctor', 53, '08:30', '09:23');
    raise exception 'Weekend doctor visit accepted';
  exception when check_violation then null; end;
  begin
    insert into public.work_days (user_id, date, type, duration_minutes, doctor_from, doctor_to)
    values (auth.uid(), '2026-10-02', 'doctor', 53, '08:30:01', '09:23:01');
    raise exception 'Second-precision doctor visit accepted';
  exception when check_violation then null; end;
  begin
    insert into public.work_days (user_id, date, type, duration_minutes)
    values (auth.uid(), '2026-10-02', 'vacation', 53);
    raise exception 'Non-doctor minute precision accepted';
  exception when check_violation then null; end;
  begin
    insert into public.work_days (user_id, date, type, duration_minutes, doctor_from, doctor_to)
    values (auth.uid(), '2026-10-01', 'doctor', 480, '10:00', '18:00');
    raise exception 'Daily leave cap exceeded';
  exception when invalid_parameter_value then null; end;
end;
$$;

-- Adjacent visits and visits inside attendance are allowed.
insert into public.work_days (user_id, date, type, duration_minutes, doctor_from, doctor_to)
values (auth.uid(), '2026-10-01', 'doctor', 30, '09:23', '09:53');
reset role;
insert into public.work_sessions (user_id, started_at, ended_at)
values ('00000000-0000-0000-0000-000000000002', '2026-10-01T04:00:00Z', '2026-10-01T12:30:00Z');
set local role authenticated;

insert into public.work_days (user_id, date, type, duration_minutes)
select auth.uid(), make_date(year, 2, 1) + n, 'sick_day', 480
from generate_series(2028, 2029) year cross join generate_series(0, 4) n;
insert into public.work_days (user_id, date, type, duration_minutes)
select auth.uid(), make_date(year, 3, 1) + n, 'vacation', 480
from generate_series(2028, 2029) year cross join generate_series(0, 19) n;
do $$
begin
  begin
    insert into public.work_days (user_id, date, type, duration_minutes)
    values (auth.uid(), '2028-02-10', 'sick_day', 480);
    raise exception 'Annual sick allowance exceeded';
  exception when invalid_parameter_value then null; end;
  begin
    insert into public.work_days (user_id, date, type, duration_minutes)
    values (auth.uid(), '2028-03-25', 'vacation', 480);
    raise exception 'Annual vacation allowance exceeded';
  exception when invalid_parameter_value then null; end;
end;
$$;
rollback;
