-- =====================================================================
-- Iceland Aero Agents – Staff Portal
-- Update 04: Training (quiz attempts, sign-offs, certificates)
--
-- Run AFTER 03-fix-profile-save.sql: SQL Editor → paste all → Run.
-- Then: Data API page → "Refresh schema cache".
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Job titles (printed under the signature on certificates)
-- ---------------------------------------------------------------------
alter table public.profiles    add column if not exists job_title text;
alter table public.invitations add column if not exists job_title text;

update public.profiles    set job_title = 'Chief Operating Officer'  where email = 'josh@iaa.is'   and job_title is null;
update public.invitations set job_title = 'Chief Executive Officer'  where email = 'gtv@iaa.is'    and job_title is null;
update public.invitations set job_title = 'Managing Director'        where email = 'hjalti@iaa.is' and job_title is null;
update public.profiles    set job_title = 'Chief Executive Officer'  where email = 'gtv@iaa.is'    and job_title is null;
update public.profiles    set job_title = 'Managing Director'        where email = 'hjalti@iaa.is' and job_title is null;

-- New sign-ups copy the job title from their invitation.
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
    insert into public.profiles (id, email, full_name, role, station_code, job_title)
    values (
      uid,
      u_email,
      coalesce(nullif(trim(inv.full_name), ''), nullif(trim(u_name), '')),
      inv.role,
      inv.station_code,
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


-- ---------------------------------------------------------------------
-- 2. Quiz attempts
--    source = 'portal' for attempts made here, 'legacy' for records
--    imported from the old training page (identified by name only
--    until management links them to a person).
-- ---------------------------------------------------------------------
create table public.training_attempts (
  id            bigint generated always as identity primary key,
  profile_id    text references public.profiles (id) on delete set null,
  learner_name  text not null,
  name_key      text not null,
  station       text,
  role          text,
  module        text not null,
  module_title  text,
  score         int  not null check (score >= 0),
  total         int  not null check (total > 0 and score <= total),
  pct           int  not null,
  passed        boolean not null,
  attempted_at  timestamptz not null default now(),
  manual        text,
  source        text not null default 'portal' check (source in ('portal', 'legacy')),
  legacy_id     text unique,
  check (pct = round(score * 100.0 / total)),
  check (passed = (score * 5 >= total * 4))
);

create index training_attempts_profile_idx on public.training_attempts (profile_id, module);
create index training_attempts_name_idx    on public.training_attempts (name_key);

-- Attempts made in the portal always belong to whoever is signed in,
-- whatever the page sends.
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
  new.station      := p.station_code;
  new.role         := null;
  new.attempted_at := now();
  return new;
end;
$$;

create trigger fill_training_attempt
  before insert on public.training_attempts
  for each row execute function public.fill_training_attempt();


-- ---------------------------------------------------------------------
-- 3. Sign-offs (certificates)
-- ---------------------------------------------------------------------
create table public.training_signoffs (
  id                 bigint generated always as identity primary key,
  profile_id         text references public.profiles (id) on delete set null,
  learner_name       text not null,
  name_key           text not null,
  station            text,
  module             text not null,
  module_code        text,
  module_title       text,
  part               text,
  pct                int,
  passed_at          timestamptz,
  signer_profile_id  text,
  signer_email       text,
  signer_name        text not null,
  signer_title       text,
  signed_at          timestamptz not null default now(),
  cert_no            text not null unique,
  manual             text,
  source             text not null default 'portal' check (source in ('portal', 'legacy')),
  revoked_at         timestamptz,
  revoked_by         text
);

-- One valid certificate per person per module.
create unique index training_signoffs_one_active
  on public.training_signoffs ((coalesce(profile_id, 'name:' || name_key)), module)
  where revoked_at is null;


-- ---------------------------------------------------------------------
-- 4. Actions management can take (each checks permissions itself)
-- ---------------------------------------------------------------------

-- Sign off a passed module for a person.
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
    learner.station_code,
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

-- Revoke a certificate (kept on record, marked as revoked).
create or replace function public.training_revoke(p_signoff_id bigint)
returns public.training_signoffs
language plpgsql security definer set search_path = ''
as $$
declare
  result public.training_signoffs;
begin
  if not public.is_management() then
    raise exception 'Only management can revoke certificates';
  end if;

  update public.training_signoffs
     set revoked_at = now(), revoked_by = auth.user_id()
   where id = p_signoff_id and revoked_at is null
  returning * into result;

  if result.id is null then
    raise exception 'Certificate not found or already revoked';
  end if;

  insert into public.audit_log (actor_id, action, details)
  values (auth.user_id(), 'training_certificate_revoked',
          jsonb_build_object('signoff_id', result.id, 'cert_no', result.cert_no));

  return result;
end;
$$;

-- Attach imported records (identified by name) to a person's account.
create or replace function public.training_link_records(p_name_key text, p_profile_id text)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  n_att int;
  n_so  int;
begin
  if not public.is_management() then
    raise exception 'Only management can link training records';
  end if;

  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'Person not found';
  end if;

  update public.training_attempts
     set profile_id = p_profile_id
   where name_key = p_name_key and source = 'legacy' and profile_id is null;
  get diagnostics n_att = row_count;

  update public.training_signoffs
     set profile_id = p_profile_id
   where name_key = p_name_key and source = 'legacy' and profile_id is null;
  get diagnostics n_so = row_count;

  insert into public.audit_log (actor_id, action, details)
  values (auth.user_id(), 'training_records_linked',
          jsonb_build_object('name_key', p_name_key, 'profile_id', p_profile_id, 'attempts', n_att, 'signoffs', n_so));

  return n_att + n_so;
end;
$$;

revoke all on function public.training_sign_off(text, text, text, text, text, text) from public;
revoke all on function public.training_revoke(bigint)                              from public;
revoke all on function public.training_link_records(text, text)                    from public;
grant execute on function public.training_sign_off(text, text, text, text, text, text) to authenticated;
grant execute on function public.training_revoke(bigint)                              to authenticated;
grant execute on function public.training_link_records(text, text)                    to authenticated;


-- ---------------------------------------------------------------------
-- 5. Permissions and access rules
-- ---------------------------------------------------------------------
alter table public.training_attempts enable row level security;
alter table public.training_signoffs enable row level security;

revoke all on public.training_attempts, public.training_signoffs from authenticated;
grant select, insert on public.training_attempts to authenticated;
grant select         on public.training_signoffs to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Attempts
create policy "Staff can record their own attempts"
  on public.training_attempts for insert to authenticated
  with check (profile_id = auth.user_id() and source = 'portal' and public.my_role() is not null);

create policy "Staff can read their own attempts"
  on public.training_attempts for select to authenticated
  using (profile_id = auth.user_id());

create policy "Station leads can read their station's attempts"
  on public.training_attempts for select to authenticated
  using (
    public.my_role() = 'station_lead'
    and exists (select 1 from public.profiles p
                 where p.id = training_attempts.profile_id
                   and p.station_code = public.my_station())
  );

create policy "Management can read all attempts"
  on public.training_attempts for select to authenticated
  using (public.is_management());

-- Sign-offs
create policy "Staff can read their own certificates"
  on public.training_signoffs for select to authenticated
  using (profile_id = auth.user_id());

create policy "Station leads can read their station's certificates"
  on public.training_signoffs for select to authenticated
  using (
    public.my_role() = 'station_lead'
    and exists (select 1 from public.profiles p
                 where p.id = training_signoffs.profile_id
                   and p.station_code = public.my_station())
  );

create policy "Management can read all certificates"
  on public.training_signoffs for select to authenticated
  using (public.is_management());
