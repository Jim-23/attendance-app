-- Run after fixture.sql and the migration in the disposable test database.
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

do $$
declare
  key text;
  valid_key text;
begin
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'no-key@example.invalid');
    raise exception 'TEST FAILED: keyless registration accepted';
  exception when insufficient_privilege then null;
  end;
  key := public.admin_create_invitation('INVITED@example.invalid', 7);
  if length(key) <> 64 then raise exception 'TEST FAILED: key length'; end if;
  begin
    insert into auth.users (id, email, raw_user_meta_data)
      values (gen_random_uuid(), 'wrong@example.invalid', jsonb_build_object('registration_key', key));
    raise exception 'TEST FAILED: wrong email accepted';
  exception when insufficient_privilege then null;
  end;
  insert into auth.users (id, email, raw_user_meta_data)
    values ('00000000-0000-0000-0000-000000000003', 'invited@example.invalid',
      jsonb_build_object('registration_key', key, 'role', 'admin', 'full_name', 'Invited'));
  if (select role from public.profiles where id = '00000000-0000-0000-0000-000000000003') <> 'user' then
    raise exception 'TEST FAILED: role metadata escalated privileges';
  end if;
  if (select raw_user_meta_data ? 'registration_key' from auth.users
      where id = '00000000-0000-0000-0000-000000000003') then
    raise exception 'TEST FAILED: raw key retained';
  end if;
  begin
    insert into auth.users (id, email, raw_user_meta_data)
      values (gen_random_uuid(), 'invited@example.invalid', jsonb_build_object('registration_key', key));
    raise exception 'TEST FAILED: invitation reused';
  exception when insufficient_privilege then null;
  end;
  valid_key := public.admin_create_invitation(null, 1);
  update public.registration_invitations set created_at = now() - interval '3 days',
    expires_at = now() - interval '1 day'
    where key_hash = encode(sha256(convert_to(valid_key, 'UTF8')), 'hex');
  begin
    insert into auth.users (id, email, raw_user_meta_data)
      values (gen_random_uuid(), 'expired@example.invalid', jsonb_build_object('registration_key', valid_key));
    raise exception 'TEST FAILED: expired invitation accepted';
  exception when insufficient_privilege then null;
  end;
  valid_key := public.admin_create_invitation(null, 1);
  perform public.admin_revoke_invitation(id) from public.registration_invitations
    where key_hash = encode(sha256(convert_to(valid_key, 'UTF8')), 'hex');
  begin
    insert into auth.users (id, email, raw_user_meta_data)
      values (gen_random_uuid(), 'revoked@example.invalid', jsonb_build_object('registration_key', valid_key));
    raise exception 'TEST FAILED: revoked invitation accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local role authenticated;
do $$
begin
  if (select count(*) from public.admin_list_users()) <> 3 then
    raise exception 'TEST FAILED: admin cannot list users';
  end if;
  begin
    perform public.admin_update_user('00000000-0000-0000-0000-000000000001', 'Admin', 'user');
    raise exception 'TEST FAILED: last admin demoted';
  exception when invalid_parameter_value then null;
  end;
  perform public.admin_update_user('00000000-0000-0000-0000-000000000002', 'User', 'admin');
  perform public.admin_update_user('00000000-0000-0000-0000-000000000002', 'User', 'user');
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
do $$
begin
  if public.is_admin() then raise exception 'TEST FAILED: user treated as admin'; end if;
  begin
    perform public.admin_list_users();
    raise exception 'TEST FAILED: regular user listed users';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_create_invitation(null, 7);
    raise exception 'TEST FAILED: regular user created invitation';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_list_invitations();
    raise exception 'TEST FAILED: regular user listed invitations';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_revoke_invitation(gen_random_uuid());
    raise exception 'TEST FAILED: regular user revoked invitation';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.registration_invitations;
    raise exception 'TEST FAILED: raw invitation table exposed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_update_user('00000000-0000-0000-0000-000000000002', 'User', 'admin');
    raise exception 'TEST FAILED: regular user called role RPC';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set role = 'admin' where id = auth.uid();
    raise exception 'TEST FAILED: direct role update allowed';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'TEST FAILED: regular user sees other profiles';
  end if;
end;
$$;

insert into public.work_days (user_id, date, type, duration_minutes)
  values ('00000000-0000-0000-0000-000000000002', '2026-10-02', 'mandatory_vacation', 480);
do $$
begin
  begin
    insert into public.work_days (user_id, date, type, duration_minutes)
      values (auth.uid(), '2026-10-03', 'mandatory_vacation', 480);
    raise exception 'TEST FAILED: weekend company-wide leave';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into public.work_days (user_id, date, type, duration_minutes)
      values (auth.uid(), '2026-10-05', 'mandatory_vacation', 240);
    raise exception 'TEST FAILED: partial company-wide leave';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into public.work_days (user_id, date, type, duration_minutes)
      values (auth.uid(), '2026-10-02', 'vacation', 240);
    raise exception 'TEST FAILED: daily leave limit exceeded';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
insert into public.work_days (user_id, date, type, duration_minutes)
  select '00000000-0000-0000-0000-000000000002', date, 'vacation', 480
  from generate_series('2026-01-01'::date, '2026-01-19'::date, interval '1 day') as date;
do $$
begin
  begin
    insert into public.work_days (user_id, date, type, duration_minutes)
      values (auth.uid(), '2026-10-06', 'mandatory_vacation', 480);
    raise exception 'TEST FAILED: shared vacation limit exceeded';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
reset role;
insert into public.work_sessions(user_id, started_at, ended_at)
  values ('00000000-0000-0000-0000-000000000001', '2026-10-01T06:00:00Z', '2026-10-01T14:30:00Z');
set local role authenticated;
do $$
begin
  if exists (select 1 from public.work_sessions) then
    raise exception 'TEST FAILED: regular user reads another users sessions';
  end if;
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
do $$
begin
  if (select count(*) from public.work_sessions) <> 1
     or (select count(*) from public.work_days) <> 20 then
    raise exception 'TEST FAILED: admin cannot read attendance or leave';
  end if;
end;
$$;
reset role;
rollback;
select 'Invitation, role, RLS and leave allowance regression checks passed' as result;
