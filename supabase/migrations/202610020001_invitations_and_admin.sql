begin;

create table public.registration_invitations (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique,
  email text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id),
  revoked_at timestamptz,
  check (expires_at > created_at)
);

alter table public.registration_invitations enable row level security;
revoke all on public.registration_invitations from public, anon, authenticated;

create function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- The supplied own-profile UPDATE policy does not protect individual columns.
revoke update on public.profiles from public, anon, authenticated;
revoke update (id, full_name, role, daily_work_minutes, created_at)
  on public.profiles from public, anon, authenticated;
grant update (full_name) on public.profiles to authenticated;
revoke insert, delete on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;

alter table public.profiles enable row level security;
alter table public.work_sessions enable row level security;
alter table public.work_days enable row level security;

create policy "Admins can view profiles" on public.profiles
  for select to authenticated using ((select public.is_admin()));
create policy "Admins can view work sessions" on public.work_sessions
  for select to authenticated using ((select public.is_admin()));
create policy "Admins can view work days" on public.work_days
  for select to authenticated using ((select public.is_admin()));

create function public.admin_list_users()
returns table (
  id uuid, email text, full_name text, role text,
  daily_work_minutes integer, created_at timestamptz
)
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  return query
    select p.id, u.email::text, p.full_name, p.role, p.daily_work_minutes, p.created_at
    from public.profiles p join auth.users u on u.id = p.id
    order by p.created_at, p.id;
end;
$$;

create function public.admin_update_user(
  target_id uuid, new_full_name text, new_role text
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  previous_role text;
begin
  -- Serializes role changes, including concurrent attempts to demote the last admin.
  perform pg_catalog.pg_advisory_xact_lock(20261002, 1);
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if new_role is null or new_role not in ('user', 'admin') then
    raise exception 'Invalid role' using errcode = '22023';
  end if;
  select role into previous_role from public.profiles where id = target_id for update;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  if previous_role = 'admin' and new_role = 'user'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'Cannot remove the last admin' using errcode = '22023';
  end if;
  update public.profiles
    set full_name = nullif(btrim(new_full_name), ''), role = new_role
    where id = target_id;
end;
$$;

create function public.admin_create_invitation(
  invited_email text default null, valid_days integer default 7
)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  invitation_key text;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if valid_days is null or valid_days < 1 or valid_days > 30 then
    raise exception 'Validity must be between 1 and 30 days' using errcode = '22023';
  end if;
  invitation_key := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.registration_invitations (key_hash, email, created_by, expires_at)
    values (
      encode(sha256(convert_to(invitation_key, 'UTF8')), 'hex'),
      nullif(lower(btrim(invited_email)), ''),
      auth.uid(),
      now() + valid_days * interval '1 day'
    );
  return invitation_key;
end;
$$;

create function public.admin_list_invitations()
returns table (
  id uuid, email text, created_at timestamptz, expires_at timestamptz,
  used_at timestamptz, revoked_at timestamptz
)
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  return query
    select i.id, i.email, i.created_at, i.expires_at, i.used_at, i.revoked_at
    from public.registration_invitations i order by i.created_at desc, i.id;
end;
$$;

create function public.admin_revoke_invitation(invitation_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  update public.registration_invitations set revoked_at = now()
    where id = invitation_id and used_at is null and revoked_at is null;
  if not found then
    raise exception 'Invitation unavailable' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.admin_list_users() from public;
revoke all on function public.admin_update_user(uuid, text, text) from public;
revoke all on function public.admin_create_invitation(text, integer) from public;
revoke all on function public.admin_list_invitations() from public;
revoke all on function public.admin_revoke_invitation(uuid) from public;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_update_user(uuid, text, text) to authenticated;
grant execute on function public.admin_create_invitation(text, integer) to authenticated;
grant execute on function public.admin_list_invitations() to authenticated;
grant execute on function public.admin_revoke_invitation(uuid) to authenticated;

-- Existing auth.users AFTER INSERT trigger already calls this function.
-- Consumption and account creation commit together; rejected registrations roll back.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  invitation_id uuid;
  registration_key text := new.raw_user_meta_data ->> 'registration_key';
begin
  if new.email is null or registration_key is null or length(registration_key) <> 64 then
    raise exception 'Valid registration invitation required' using errcode = '42501';
  end if;
  update public.registration_invitations
    set used_at = now(), used_by = new.id
    where key_hash = encode(sha256(convert_to(registration_key, 'UTF8')), 'hex')
      and used_at is null and revoked_at is null and expires_at > now()
      and (email is null or email = lower(new.email))
    returning id into invitation_id;
  if invitation_id is null then
    raise exception 'Invalid, expired or already used registration invitation'
      using errcode = '42501';
  end if;
  insert into public.profiles (id, full_name, role)
    values (new.id, nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), 'user');
  update auth.users
    set raw_user_meta_data = raw_user_meta_data - 'registration_key'
    where id = new.id;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Enforce the existing eight-hour leave limit and shared vacation allowance.
-- A per-user lock makes simultaneous inserts obey the same limits.
create function public.validate_leave_allowance()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  used_minutes bigint;
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception 'Cannot change leave owner' using errcode = '22023';
  end if;
  perform 1 from public.profiles where id = new.user_id for update;
  if new.duration_minutes is null then
    raise exception 'Leave duration is required' using errcode = '22023';
  end if;
  if new.type = 'mandatory_vacation'
     and (new.duration_minutes <> 480 or extract(isodow from new.date) > 5) then
    raise exception 'Company-wide vacation requires one weekday and 480 minutes'
      using errcode = '22023';
  end if;
  select coalesce(sum(coalesce(duration_minutes, 480)), 0) into used_minutes
    from public.work_days
    where user_id = new.user_id and date = new.date
      and (tg_op = 'INSERT' or id <> new.id);
  if used_minutes + new.duration_minutes > 480 then
    raise exception 'Daily leave limit exceeded' using errcode = '22023';
  end if;
  if new.type in ('vacation', 'mandatory_vacation', 'sick_day') then
    select coalesce(sum(coalesce(duration_minutes, 480)), 0) into used_minutes
      from public.work_days
      where user_id = new.user_id
        and extract(year from date) = extract(year from new.date)
        and (tg_op = 'INSERT' or id <> new.id)
        and (
          (new.type = 'sick_day' and type = 'sick_day')
          or (new.type <> 'sick_day' and type in ('vacation', 'mandatory_vacation'))
        );
    if used_minutes + new.duration_minutes >
       (case when new.type = 'sick_day' then 5 * 480 else 20 * 480 end) then
      raise exception 'Annual leave allowance exceeded' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.validate_leave_allowance() from public, anon, authenticated;
create trigger validate_leave_allowance before insert or update on public.work_days
  for each row execute function public.validate_leave_allowance();

commit;
