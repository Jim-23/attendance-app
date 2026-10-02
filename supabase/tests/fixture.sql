-- Only run in a fresh disposable PostgreSQL database, never in live Supabase.
create role anon;
create role authenticated;
create schema auth;
create table auth.users (
  id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  daily_work_minutes integer not null default 480 check (daily_work_minutes > 0),
  created_at timestamptz not null default now()
);
create table public.work_sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null, ended_at timestamptz, lunch_started_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index one_open_session_per_user on public.work_sessions(user_id)
  where ended_at is null;
create table public.work_days (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  type text not null check (type in ('holiday', 'vacation', 'sick_day', 'comp_time', 'mandatory_vacation')),
  note text,
  created_at timestamptz not null default now(),
  duration_minutes integer check (duration_minutes is null or (duration_minutes > 0 and duration_minutes % 15 = 0))
);
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
alter table public.profiles enable row level security;
alter table public.work_sessions enable row level security;
alter table public.work_days enable row level security;
create policy "Users can update their own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "Users can view their own profile" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "Users can view their own work sessions" on public.work_sessions
  for select to authenticated using (user_id = auth.uid());
create policy "Users can view their own work days" on public.work_days
  for select to authenticated using (user_id = auth.uid());
create policy "Users can create their own work days" on public.work_days
  for insert to authenticated with check (user_id = auth.uid());
create policy "Users can update their own work days" on public.work_days
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create function public.handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name) values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'admin@example.invalid'),
  ('00000000-0000-0000-0000-000000000002', 'user@example.invalid');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000001';
