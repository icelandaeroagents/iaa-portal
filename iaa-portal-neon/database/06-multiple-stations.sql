-- =====================================================================
-- Iceland Aero Agents – Staff Portal
-- Update 06: people can belong to several stations
--
-- Run AFTER 05-import-old-training-records.sql:
--   SQL Editor → paste all of this → Run.
-- Then: Data API page → "Refresh schema cache".
--
-- Each person's single station becomes a list of stations. Everyone
-- keeps the station they have today as the first entry in their list.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. New station lists, filled from today's single station
-- ---------------------------------------------------------------------
alter table public.profiles    add column station_codes text[] not null default '{}';
alter table public.invitations add column station_codes text[] not null default '{}';

update public.profiles    set station_codes = array[station_code] where station_code is not null;
update public.invitations set station_codes = array[station_code] where station_code is not null;

-- Only real station codes, no repeats, kept in a tidy order.
create or replace function public.clean_station_codes()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  bad text;
begin
  new.station_codes := coalesce(
    (select array_agg(c order by s.sort_order, c)
       from (select distinct unnest(new.station_codes) as c) x
       left join public.stations s on s.code = x.c),
    '{}'
  );

  select c into bad
    from unnest(new.station_codes) as c
   where not exists (select 1 from public.stations s where s.code = c)
   limit 1;

  if bad is not null then
    raise exception 'Unknown station: %', bad;
  end if;

  return new;
end;
$$;

create trigger clean_station_codes
  before insert or update of station_codes on public.profiles
  for each row execute function public.clean_station_codes();

create trigger clean_station_codes
  before insert or update of station_codes on public.invitations
  for each row execute function public.clean_station_codes();


-- ---------------------------------------------------------------------
-- 2. Helper: the signed-in person's stations
-- ---------------------------------------------------------------------
create or replace function public.my_stations()
returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select station_codes from public.profiles where id = auth.user_id() and active),
    '{}'::text[]
  )
$$;


-- ---------------------------------------------------------------------
-- 3. Access rules: station leads see people who share any station
-- ---------------------------------------------------------------------
drop policy "Station leads can read their station's staff"        on public.profiles;
drop policy "Station leads can read their station's attempts"     on public.training_attempts;
drop policy "Station leads can read their station's certificates" on public.training_signoffs;

create policy "Station leads can read their stations' staff"
  on public.profiles for select to authenticated
  using (public.my_role() = 'station_lead' and station_codes && public.my_stations());

create policy "Station leads can read their stations' attempts"
  on public.training_attempts for select to authenticated
  using (
    public.my_role() = 'station_lead'
    and exists (select 1 from public.profiles p
                 where p.id = training_attempts.profile_id
                   and p.station_codes && public.my_stations())
  );

create policy "Station leads can read their stations' certificates"
  on public.training_signoffs for select to authenticated
  using (
    public.my_role() = 'station_lead'
    and exists (select 1 from public.profiles p
                 where p.id = training_signoffs.profile_id
                   and p.station_codes && public.my_stations())
  );


-- ---------------------------------------------------------------------
-- 4. Functions updated to use the station list
-- ---------------------------------------------------------------------
create or replace function public.guard_profile_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.user_id() is not null and not public.is_management() then
    if new.role          is distinct from old.role
    or new.station_codes is distinct from old.station_codes
    or new.active        is distinct from old.active
    or new.email         is distinct from old.email
    or new.id            is distinct from old.id then
      raise exception 'Only management can change role, station or access';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

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
    insert into public.profiles (id, email, full_name, role, station_codes, job_title)
    values (
      uid,
      u_email,
      coalesce(nullif(trim(inv.full_name), ''), nullif(trim(u_name), '')),
      inv.role,
      inv.station_codes,
      nullif(trim(inv.job_title), '')
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

create or replace function public.fill_training_attempt()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  p public.profiles;
begin
  if auth.user_id() is null then
    return new;  -- SQL Editor / imports
  end if;

  select * into p from public.profiles where id = auth.user_id() and active;
  if not found then
    raise exception 'No active profile';
  end if;

  new.source       := 'portal';
  new.legacy_id    := null;
  new.profile_id   := p.id;
  new.learner_name := coalesce(nullif(trim(p.full_name), ''), p.email);
  new.name_key     := lower(regexp_replace(trim(new.learner_name), '\s+', ' ', 'g'));
  new.station      := nullif(array_to_string(p.station_codes, ', '), '');
  new.role         := null;
  new.attempted_at := now();
  return new;
end;
$$;

create or replace function public.training_sign_off(
  p_profile_id   text,
  p_module       text,
  p_module_code  text,
  p_module_title text,
  p_part         text,
  p_manual       text
)
returns public.training_signoffs
language plpgsql security definer set search_path = ''
as $$
declare
  signer   public.profiles;
  learner  public.profiles;
  best_pct int;
  first_ok timestamptz;
  result   public.training_signoffs;
begin
  if not public.is_management() then
    raise exception 'Only management can sign off training';
  end if;

  select * into signer from public.profiles where id = auth.user_id();
  if nullif(trim(signer.full_name), '') is null or nullif(trim(signer.job_title), '') is null then
    raise exception 'Add your name and job title on the Home page before signing off';
  end if;

  select * into learner from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Person not found';
  end if;

  select max(a.pct), min(a.attempted_at) filter (where a.passed)
    into best_pct, first_ok
    from public.training_attempts a
   where a.profile_id = p_profile_id and a.module = p_module;

  if first_ok is null then
    raise exception 'This module has not been passed yet';
  end if;

  insert into public.training_signoffs (
    profile_id, learner_name, name_key, station, module, module_code, module_title, part,
    pct, passed_at, signer_profile_id, signer_email, signer_name, signer_title,
    cert_no, manual, source
  ) values (
    learner.id,
    coalesce(nullif(trim(learner.full_name), ''), learner.email),
    lower(regexp_replace(trim(coalesce(nullif(trim(learner.full_name), ''), learner.email)), '\s+', ' ', 'g')),
    nullif(array_to_string(learner.station_codes, ', '), ''),
    p_module, p_module_code, p_module_title, p_part,
    best_pct, first_ok, signer.id, signer.email, signer.full_name, signer.job_title,
    'IAA-' || coalesce(p_module_code, p_module) || '-' || to_char(now(), 'YYYYMMDD') || '-' ||
      upper(substr(md5(learner.id || p_module || now()::text), 1, 4)),
    p_manual, 'portal'
  )
  returning * into result;

  insert into public.audit_log (actor_id, action, details)
  values (signer.id, 'training_signed_off',
          jsonb_build_object('signoff_id', result.id, 'profile_id', learner.id, 'module', p_module, 'cert_no', result.cert_no));

  return result;
end;
$$;

revoke all on function public.training_sign_off(text, text, text, text, text, text) from public;
grant execute on function public.training_sign_off(text, text, text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 5. Remove the old single-station columns
-- ---------------------------------------------------------------------
alter table public.profiles    drop column station_code;
alter table public.invitations drop column station_code;
drop function public.my_station();
