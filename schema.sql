-- =====================================================================
-- Iceland Aero Agents – Staff Portal
-- Foundation schema: stations, staff profiles, roles, audit log
--
-- Run once in Supabase: SQL Editor → New query → paste all → Run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Stations (kept as data, so a new station is a row, not a rebuild)
-- ---------------------------------------------------------------------
create table public.stations (
  code        text primary key check (code ~ '^[A-Z]{4}$'),
  name        text not null,
  active      boolean not null default true,
  sort_order  int not null default 100,
  created_at  timestamptz not null default now()
);

insert into public.stations (code, name, sort_order) values
  ('BIRK', 'Reykjavík', 10),
  ('BIKF', 'Keflavík',  20),
  ('BIAR', 'Akureyri',  30);


-- ---------------------------------------------------------------------
-- 2. Email domains allowed to create an account
--    Anyone signing in with another domain is refused.
-- ---------------------------------------------------------------------
create table public.allowed_email_domains (
  domain text primary key
);

insert into public.allowed_email_domains (domain) values ('iaa.is');


-- ---------------------------------------------------------------------
-- 3. Staff profiles and roles
-- ---------------------------------------------------------------------
create type public.portal_role as enum ('staff', 'station_lead', 'management');

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  full_name     text,
  role          public.portal_role not null default 'staff',
  station_code  text references public.stations (code),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 4. Audit log: who did what, and when
-- ---------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid default auth.uid() references auth.users (id) on delete set null,
  action      text not null,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index audit_log_created_at_idx on public.audit_log (created_at desc);


-- ---------------------------------------------------------------------
-- 5. Helper functions used by the access rules
-- ---------------------------------------------------------------------
create or replace function public.my_role()
returns public.portal_role
language sql stable security definer set search_path = ''
as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.my_station()
returns text
language sql stable security definer set search_path = ''
as $$
  select station_code from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_management()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.my_role() = 'management', false)
$$;


-- ---------------------------------------------------------------------
-- 6. Sign-up rules
-- ---------------------------------------------------------------------

-- Refuse accounts outside the allowed company domains.
create or replace function public.check_email_domain()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.allowed_email_domains d
    where d.domain = lower(split_part(new.email, '@', 2))
  ) then
    raise exception 'Sign-up is limited to company email addresses';
  end if;
  return new;
end;
$$;

create trigger check_email_domain
  before insert on auth.users
  for each row execute function public.check_email_domain();

-- Create a staff profile for every new account.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only management can change someone's role, station or access.
-- Changes made from the SQL Editor (no signed-in user) are allowed,
-- which is how you make the first management user.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_management() then
    if new.role         is distinct from old.role
    or new.station_code is distinct from old.station_code
    or new.active       is distinct from old.active
    or new.email        is distinct from old.email
    or new.id           is distinct from old.id then
      raise exception 'Only management can change role, station or access';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();


-- ---------------------------------------------------------------------
-- 7. Access rules (row level security)
-- ---------------------------------------------------------------------
alter table public.stations              enable row level security;
alter table public.allowed_email_domains enable row level security;
alter table public.profiles              enable row level security;
alter table public.audit_log             enable row level security;

-- Nothing is readable without signing in.
revoke all on public.stations, public.allowed_email_domains,
              public.profiles, public.audit_log from anon;

grant select, insert, update on public.stations              to authenticated;
grant select                 on public.allowed_email_domains to authenticated;
grant select, update         on public.profiles              to authenticated;
grant select, insert         on public.audit_log             to authenticated;

-- Stations
create policy "Signed-in staff can read stations"
  on public.stations for select to authenticated
  using (true);

create policy "Management can add stations"
  on public.stations for insert to authenticated
  with check (public.is_management());

create policy "Management can edit stations"
  on public.stations for update to authenticated
  using (public.is_management())
  with check (public.is_management());

-- Allowed domains (changed from the SQL Editor only)
create policy "Management can read allowed domains"
  on public.allowed_email_domains for select to authenticated
  using (public.is_management());

-- Profiles
create policy "Staff can read their own profile"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "Station leads can read their station's staff"
  on public.profiles for select to authenticated
  using (public.my_role() = 'station_lead' and station_code = public.my_station());

create policy "Management can read all profiles"
  on public.profiles for select to authenticated
  using (public.is_management());

create policy "Staff can update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "Management can update all profiles"
  on public.profiles for update to authenticated
  using (public.is_management())
  with check (public.is_management());

-- Audit log
create policy "Staff can add their own audit entries"
  on public.audit_log for insert to authenticated
  with check (actor_id = auth.uid());

create policy "Management can read the audit log"
  on public.audit_log for select to authenticated
  using (public.is_management());


-- =====================================================================
-- AFTER YOU HAVE SIGNED IN ONCE, make yourself management by running
-- this line on its own (with your own address):
--
--   update public.profiles set role = 'management' where email = 'you@iaa.is';
-- =====================================================================
