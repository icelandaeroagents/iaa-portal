-- =====================================================================
-- Iceland Aero Agents – Staff Portal
-- Foundation schema for Neon: stations, staff profiles, roles, audit log
--
-- BEFORE running this, in the Neon Console:
--   1. Turn on Auth (Managed Better Auth).
--   2. Turn on the Data API with "Use Neon Auth" ticked.
-- Then: SQL Editor → paste all of this → Run.
-- AFTER running it: Data API page → "Refresh schema cache".
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
-- 2. Email domains allowed into the portal
--    Neon Auth lets anyone create a login, so the portal itself only
--    gives a profile (and therefore access) to these domains.
-- ---------------------------------------------------------------------
create table public.allowed_email_domains (
  domain text primary key
);

insert into public.allowed_email_domains (domain) values ('iaa.is');


-- ---------------------------------------------------------------------
-- 3. Staff profiles and roles
--    id is the Neon Auth user id (the "sub" in the sign-in token).
-- ---------------------------------------------------------------------
create type public.portal_role as enum ('staff', 'station_lead', 'management');

create table public.profiles (
  id            text primary key,
  email         text not null unique,
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
  actor_id    text default auth.user_id(),
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
  select role from public.profiles where id = auth.user_id() and active
$$;

create or replace function public.my_station()
returns text
language sql stable security definer set search_path = ''
as $$
  select station_code from public.profiles where id = auth.user_id() and active
$$;

create or replace function public.is_management()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.my_role() = 'management', false)
$$;


-- ---------------------------------------------------------------------
-- 6. Joining the portal
--    The portal calls this after every sign-in. It returns the person's
--    profile, creating it the first time – but only for a verified email
--    address on an allowed company domain.
-- ---------------------------------------------------------------------
create or replace function public.claim_profile()
returns public.profiles
language plpgsql security definer set search_path = ''
as $$
declare
  uid      text := auth.user_id();
  u_email  text;
  u_name   text;
  u_ok     boolean;
  result   public.profiles;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  select * into result from public.profiles where id = uid;
  if found then
    return result;
  end if;

  select lower(u.email), u.name, coalesce(u."emailVerified", false)
    into u_email, u_name, u_ok
    from neon_auth."user" u
   where u.id::text = uid;

  if u_email is null then
    raise exception 'Account not found';
  end if;

  if not u_ok then
    raise exception 'Email address not verified';
  end if;

  if not exists (
    select 1 from public.allowed_email_domains d
    where d.domain = split_part(u_email, '@', 2)
  ) then
    raise exception 'Sign-in is limited to company email addresses';
  end if;

  insert into public.profiles (id, email, full_name)
  values (uid, u_email, nullif(trim(u_name), ''))
  returning * into result;

  return result;
end;
$$;

-- Only management can change someone's role, station or access.
-- Changes made in the SQL Editor (no signed-in portal user) are allowed,
-- which is how you make the first management user.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if auth.user_id() is not null and not public.is_management() then
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
-- 7. Permissions and access rules (row level security)
-- ---------------------------------------------------------------------
alter table public.stations              enable row level security;
alter table public.allowed_email_domains enable row level security;
alter table public.profiles              enable row level security;
alter table public.audit_log             enable row level security;

grant usage on schema public to authenticated;

revoke all on public.stations, public.allowed_email_domains,
              public.profiles, public.audit_log from authenticated;

grant select, insert, update on public.stations              to authenticated;
grant select                 on public.allowed_email_domains to authenticated;
grant select, update         on public.profiles              to authenticated;
grant select, insert         on public.audit_log             to authenticated;
grant usage, select on all sequences in schema public        to authenticated;

revoke all on function public.claim_profile() from public;
grant execute on function public.claim_profile() to authenticated;

-- Stations
create policy "Signed-in staff can read stations"
  on public.stations for select to authenticated
  using (public.my_role() is not null);

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
  using (id = auth.user_id());

create policy "Station leads can read their station's staff"
  on public.profiles for select to authenticated
  using (public.my_role() = 'station_lead' and station_code = public.my_station());

create policy "Management can read all profiles"
  on public.profiles for select to authenticated
  using (public.is_management());

create policy "Staff can update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.user_id())
  with check (id = auth.user_id());

create policy "Management can update all profiles"
  on public.profiles for update to authenticated
  using (public.is_management())
  with check (public.is_management());

-- Audit log
create policy "Staff can add their own audit entries"
  on public.audit_log for insert to authenticated
  with check (actor_id = auth.user_id() and public.my_role() is not null);

create policy "Management can read the audit log"
  on public.audit_log for select to authenticated
  using (public.is_management());


-- =====================================================================
-- AFTER YOU HAVE SIGNED IN TO THE PORTAL ONCE, make yourself management
-- by running this line on its own (with your own address):
--
--   update public.profiles set role = 'management' where email = 'you@iaa.is';
-- =====================================================================
