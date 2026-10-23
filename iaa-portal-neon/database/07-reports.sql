-- =====================================================================
-- Iceland Aero Agents – Staff Portal
-- Update 07: internal reports (with photos, follow-up and email)
--
-- Run AFTER 06-multiple-stations.sql: SQL Editor → paste all → Run.
-- Then: Data API page → "Refresh schema cache".
--
-- Who sees what:
--   – every active staff member can read every report and its photos
--   – the reporter can withhold their name from other staff
--   – follow-up notes are management only
--   – only management can change a report's status or follow-up
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Reports
-- ---------------------------------------------------------------------
create table public.reports (
  id                     bigint generated always as identity primary key,
  created_at             timestamptz not null default now(),

  -- What happened
  report_type            text not null check (report_type in (
                           'incident', 'near_miss', 'injury', 'aircraft_damage', 'equipment_damage',
                           'hazard', 'security', 'customer_complaint', 'other')),
  occurred_at            timestamptz not null,
  station_code           text references public.stations (code),
  location               text,
  description            text not null check (length(trim(description)) > 0),
  people_involved        text,

  -- Context
  aircraft_registration  text,
  aircraft_type          text,
  flight_number          text,
  operator               text,
  equipment              text,
  witnesses              text,
  conditions             text,

  -- Outcome
  injuries               boolean not null default false,
  injury_details         text,
  damage                 boolean not null default false,
  damage_details         text,
  consequences           text,
  immediate_actions      text,
  severity               text check (severity in ('low', 'medium', 'high')),
  suggestion             text,

  -- Reporter as shown to staff ("Name withheld" if they chose so)
  reporter_display       text,

  -- Management follow-up
  status                 text not null default 'new'
                           check (status in ('new', 'under_review', 'actions_agreed', 'closed')),
  owner_id               text references public.profiles (id) on delete set null,
  authority_flag         boolean not null default false,
  closed_at              timestamptz,

  -- Email delivery (handled by the server function)
  notified_at            timestamptz,
  notify_claimed_at      timestamptz,
  notify_error           text
);

create index reports_created_idx on public.reports (created_at desc);
create index reports_unsent_idx  on public.reports (created_at) where notified_at is null;

-- Who reported it (kept apart so a withheld name stays with management)
create table public.report_reporters (
  report_id      bigint primary key references public.reports (id) on delete cascade,
  reporter_id    text references public.profiles (id) on delete set null,
  reporter_name  text,
  reporter_email text,
  hide_name      boolean not null default false
);

-- Photos, stored with the report (resized in the browser before upload)
create table public.report_photos (
  id           bigint generated always as identity primary key,
  report_id    bigint not null references public.reports (id) on delete cascade,
  uploaded_by  text default auth.user_id(),
  mime         text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  data         text not null check (length(data) between 100 and 4000000),  -- base64, ~3 MB max
  width        int,
  height       int,
  created_at   timestamptz not null default now()
);

create index report_photos_report_idx on public.report_photos (report_id);

-- Management-only follow-up notes
create table public.report_notes (
  id           bigint generated always as identity primary key,
  report_id    bigint not null references public.reports (id) on delete cascade,
  author_id    text default auth.user_id(),
  author_name  text,
  note         text not null check (length(trim(note)) > 0),
  created_at   timestamptz not null default now()
);

create index report_notes_report_idx on public.report_notes (report_id);

-- Who receives the report emails
create table public.report_recipients (
  email text primary key check (email = lower(email))
);

insert into public.report_recipients (email) values
  ('josh@iaa.is'), ('gtv@iaa.is'), ('hjalti@iaa.is'), ('admin@iaa.is');


-- ---------------------------------------------------------------------
-- 2. Rules applied when a report is submitted or changed
-- ---------------------------------------------------------------------

-- Submitting a report: the reporter is always whoever is signed in, and
-- follow-up fields always start empty. The page sends reporter_display
-- = 'withheld' when the reporter chose to withhold their name.
create or replace function public.fill_report()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  p public.profiles;
begin
  if auth.user_id() is null then
    return new;  -- SQL Editor
  end if;

  select * into p from public.profiles where id = auth.user_id() and active;
  if not found then
    raise exception 'No active profile';
  end if;

  new.created_at        := now();
  new.status            := 'new';
  new.owner_id          := null;
  new.authority_flag    := false;
  new.closed_at         := null;
  new.notified_at       := null;
  new.notify_claimed_at := null;
  new.notify_error      := null;
  new.reporter_display  := case when new.reporter_display = 'withheld'
                                then 'Name withheld'
                                else coalesce(nullif(trim(p.full_name), ''), p.email) end;
  return new;
end;
$$;

create trigger fill_report
  before insert on public.reports
  for each row execute function public.fill_report();

create or replace function public.record_reporter()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  p public.profiles;
begin
  if auth.user_id() is null then
    return new;
  end if;
  select * into p from public.profiles where id = auth.user_id();
  insert into public.report_reporters (report_id, reporter_id, reporter_name, reporter_email, hide_name)
  values (new.id, p.id, coalesce(nullif(trim(p.full_name), ''), p.email), p.email, new.reporter_display = 'Name withheld');
  return new;
end;
$$;

create trigger record_reporter
  after insert on public.reports
  for each row execute function public.record_reporter();

-- Changing a report: management only, and the original report text stays
-- as submitted. Closing sets the closed date.
create or replace function public.guard_report_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.user_id() is not null then
    if not public.is_management() then
      raise exception 'Only management can update reports';
    end if;
    if (to_jsonb(new) - array['status', 'owner_id', 'authority_flag', 'closed_at',
                              'notified_at', 'notify_claimed_at', 'notify_error'])
       is distinct from
       (to_jsonb(old) - array['status', 'owner_id', 'authority_flag', 'closed_at',
                              'notified_at', 'notify_claimed_at', 'notify_error']) then
      raise exception 'The report itself can’t be changed after it’s submitted. Add a note instead.';
    end if;
  end if;

  if new.status = 'closed' and old.status is distinct from 'closed' then
    new.closed_at := now();
  elsif new.status <> 'closed' then
    new.closed_at := null;
  end if;
  return new;
end;
$$;

create trigger guard_report_update
  before update on public.reports
  for each row execute function public.guard_report_update();

-- Photos: the reporter can add up to 6 within 2 hours of submitting;
-- management can add more at any time.
create or replace function public.guard_report_photo()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r   public.reports;
  rep public.report_reporters;
begin
  if auth.user_id() is null then
    return new;
  end if;

  select * into r from public.reports where id = new.report_id;
  if not found then
    raise exception 'Report not found';
  end if;

  if not public.is_management() then
    select * into rep from public.report_reporters where report_id = new.report_id;
    if rep.reporter_id is distinct from auth.user_id() or r.created_at < now() - interval '2 hours' then
      raise exception 'Photos can only be added by the reporter, within 2 hours of submitting';
    end if;
    if (select count(*) from public.report_photos where report_id = new.report_id) >= 6 then
      raise exception 'A report can have up to 6 photos';
    end if;
  end if;

  new.uploaded_by := auth.user_id();
  new.created_at  := now();
  return new;
end;
$$;

create trigger guard_report_photo
  before insert on public.report_photos
  for each row execute function public.guard_report_photo();

-- Notes: author recorded automatically.
create or replace function public.fill_report_note()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  p public.profiles;
begin
  if auth.user_id() is null then
    return new;
  end if;
  select * into p from public.profiles where id = auth.user_id();
  new.author_id   := p.id;
  new.author_name := coalesce(nullif(trim(p.full_name), ''), p.email);
  new.created_at  := now();
  return new;
end;
$$;

create trigger fill_report_note
  before insert on public.report_notes
  for each row execute function public.fill_report_note();


-- ---------------------------------------------------------------------
-- 3. Permissions and access rules
-- ---------------------------------------------------------------------
alter table public.reports           enable row level security;
alter table public.report_reporters  enable row level security;
alter table public.report_photos     enable row level security;
alter table public.report_notes      enable row level security;
alter table public.report_recipients enable row level security;

revoke all on public.reports, public.report_reporters, public.report_photos,
              public.report_notes, public.report_recipients from authenticated;

grant select, insert, update on public.reports           to authenticated;
grant select                 on public.report_reporters  to authenticated;
grant select, insert         on public.report_photos     to authenticated;
grant select, insert         on public.report_notes      to authenticated;
grant select                 on public.report_recipients to authenticated;
grant usage, select on all sequences in schema public    to authenticated;

-- Reports: all active staff can read and submit; management updates.
create policy "Staff can read reports"
  on public.reports for select to authenticated
  using (public.my_role() is not null);

create policy "Staff can submit reports"
  on public.reports for insert to authenticated
  with check (public.my_role() is not null);

create policy "Management can update reports"
  on public.reports for update to authenticated
  using (public.is_management())
  with check (public.is_management());

-- Reporter details: management, and the reporter themselves.
create policy "Management and the reporter can see who reported"
  on public.report_reporters for select to authenticated
  using (public.is_management() or reporter_id = auth.user_id());

-- Photos: everyone who can read reports can see them.
create policy "Staff can see report photos"
  on public.report_photos for select to authenticated
  using (public.my_role() is not null);

create policy "Staff can add report photos"
  on public.report_photos for insert to authenticated
  with check (public.my_role() is not null);

-- Notes and recipients: management only.
create policy "Management can read report notes"
  on public.report_notes for select to authenticated
  using (public.is_management());

create policy "Management can add report notes"
  on public.report_notes for insert to authenticated
  with check (public.is_management());

create policy "Management can see report recipients"
  on public.report_recipients for select to authenticated
  using (public.is_management());


-- =====================================================================
-- To change who receives report emails, run for example:
--   insert into public.report_recipients (email) values ('someone@iaa.is');
--   delete from public.report_recipients where email = 'someone@iaa.is';
-- =====================================================================
