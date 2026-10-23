-- =====================================================================
-- Iceland Aero Agents – Staff Portal
-- Update 02: invitations (lets staff use personal email addresses)
--
-- Run AFTER schema.sql: SQL Editor → paste all of this → Run.
-- Then: Data API page → "Refresh schema cache".
--
-- Who gets in from now on:
--   – anyone whose email address management has invited, with the role
--     and station chosen in the invitation, and
--   – any verified address on an allowed company domain (iaa.is), who
--     joins as Staff with no station, as before.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Invitations
-- ---------------------------------------------------------------------
create table public.invitations (
  email         text primary key check (email = lower(email) and email like '%_@_%._%'),
  full_name     text,
  role          public.portal_role not null default 'staff',
  station_code  text references public.stations (code),
  invited_by    text default auth.user_id(),
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz
);

alter table public.invitations enable row level security;

revoke all on public.invitations from authenticated;
grant select, insert, update, delete on public.invitations to authenticated;

create policy "Management can read invitations"
  on public.invitations for select to authenticated
  using (public.is_management());

create policy "Management can create invitations"
  on public.invitations for insert to authenticated
  with check (public.is_management());

create policy "Management can edit invitations"
  on public.invitations for update to authenticated
  using (public.is_management())
  with check (public.is_management());

create policy "Management can cancel invitations"
  on public.invitations for delete to authenticated
  using (public.is_management());


-- ---------------------------------------------------------------------
-- 2. The first two management users are invited here, because nobody
--    can use the Invite form until someone is management.
-- ---------------------------------------------------------------------
insert into public.invitations (email, role, invited_by) values
  ('josh@iaa.is',  'management', null),
  ('admin@iaa.is', 'management', null)
on conflict (email) do nothing;


-- ---------------------------------------------------------------------
-- 3. Joining the portal: invitation first, then company domain
--    Returns the person's profile, creating it on their first sign-in.
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
  inv      public.invitations;
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

  select * into inv from public.invitations i
   where i.email = u_email and i.accepted_at is null;

  if found then
    insert into public.profiles (id, email, full_name, role, station_code)
    values (
      uid,
      u_email,
      coalesce(nullif(trim(inv.full_name), ''), nullif(trim(u_name), '')),
      inv.role,
      inv.station_code
    )
    returning * into result;

    update public.invitations set accepted_at = now() where email = u_email;
    return result;
  end if;

  if exists (
    select 1 from public.allowed_email_domains d
    where d.domain = split_part(u_email, '@', 2)
  ) then
    insert into public.profiles (id, email, full_name)
    values (uid, u_email, nullif(trim(u_name), ''))
    returning * into result;
    return result;
  end if;

  raise exception 'No invitation for this email address';
end;
$$;

revoke all on function public.claim_profile() from public;
grant execute on function public.claim_profile() to authenticated;

