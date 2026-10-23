-- =====================================================================
-- Iceland Aero Agents – Staff Portal
-- Update 10: roster, passes & certificates, leave, and service requests
-- SAFE TO RUN AGAIN: anything that already exists is kept as it is.
--
-- Run AFTER 09-briefings.sql: SQL Editor → paste all → Run.
-- Then: Data API page → "Refresh schema cache".
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Roster (the uploaded Excel file plus what the portal read from it)
-- ---------------------------------------------------------------------
create table if not exists public.rosters (
  id           bigint generated always as identity primary key,
  file_name    text,
  file_data    text check (file_data is null or length(file_data) < 8000000),  -- base64 .xlsx
  sheets       jsonb not null,   -- [{ name, label, blocks: [{ dates, rows: [{ label, values }] }] }]
  uploaded_at  timestamptz not null default now(),
  uploaded_by  text default auth.user_id()
);

create index if not exists rosters_latest_idx on public.rosters (uploaded_at desc);


-- ---------------------------------------------------------------------
-- 2. Passes & certificates (expiry dates only – no ID or card numbers)
-- ---------------------------------------------------------------------
create table if not exists public.credentials (
  id                bigint generated always as identity primary key,
  profile_id        text not null references public.profiles (id) on delete cascade,
  kind              text not null check (kind in (
                      'airport_pass', 'airside_driving', 'deicing', 'first_aid',
                      'dangerous_goods', 'security', 'driving_licence', 'other')),
  label             text,          -- e.g. "BIKF airport pass", "Fire safety"
  issued_on         date,
  expires_on        date,
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz,
  updated_by        text default auth.user_id(),
  reminded_30       boolean not null default false,
  reminded_7        boolean not null default false,
  reminded_expired  boolean not null default false
);

create index if not exists credentials_profile_idx on public.credentials (profile_id);
create index if not exists credentials_expiry_idx  on public.credentials (expires_on);

create or replace function public.fill_credential()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.user_id() is not null then
    if not public.is_management() then
      new.profile_id := auth.user_id();   -- staff only manage their own
    end if;
    new.updated_by := auth.user_id();
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.updated_at := now();
    if new.expires_on is distinct from old.expires_on then
      new.reminded_30 := false;
      new.reminded_7 := false;
      new.reminded_expired := false;
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger fill_credential
  before insert or update on public.credentials
  for each row execute function public.fill_credential();


-- ---------------------------------------------------------------------
-- 3. Leave & availability (private: the person and management)
-- ---------------------------------------------------------------------
create table if not exists public.leave_requests (
  id                    bigint generated always as identity primary key,
  profile_id            text not null references public.profiles (id) on delete cascade,
  kind                  text not null check (kind in ('holiday', 'unavailable', 'sick', 'other')),
  start_date            date not null,
  end_date              date not null,
  note                  text,
  status                text not null default 'pending'
                          check (status in ('pending', 'approved', 'declined', 'cancelled')),
  created_at            timestamptz not null default now(),
  decided_at            timestamptz,
  decided_by            text,
  decision_note         text,
  notified_at           timestamptz,
  notify_claimed_at     timestamptz,
  decision_notified_at  timestamptz,
  decision_claimed_at   timestamptz,
  notify_error          text,
  check (end_date >= start_date)
);

create index if not exists leave_profile_idx on public.leave_requests (profile_id, start_date);
create index if not exists leave_status_idx  on public.leave_requests (status, start_date);

create or replace function public.guard_leave()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.user_id() is null then
    return new;  -- SQL Editor / email function
  end if;

  if tg_op = 'INSERT' then
    new.profile_id := auth.user_id();
    new.status := 'pending';
    new.created_at := now();
    new.decided_at := null; new.decided_by := null; new.decision_note := null;
    new.notified_at := null; new.notify_claimed_at := null;
    new.decision_notified_at := null; new.decision_claimed_at := null; new.notify_error := null;
    return new;
  end if;

  -- Updates
  if public.is_management() then
    if new.status is distinct from old.status and new.status in ('approved', 'declined') then
      new.decided_at := now();
      new.decided_by := auth.user_id();
      new.decision_notified_at := null;
      new.decision_claimed_at := null;
    end if;
    return new;
  end if;

  -- The person themselves may only cancel a request that is still pending.
  if old.profile_id = auth.user_id() and old.status = 'pending' and new.status = 'cancelled'
     and new.start_date = old.start_date and new.end_date = old.end_date
     and new.kind = old.kind and new.note is not distinct from old.note then
    return new;
  end if;

  raise exception 'Only management can change a leave request. You can cancel your own while it is pending.';
end;
$$;

create or replace trigger guard_leave
  before insert or update on public.leave_requests
  for each row execute function public.guard_leave();


-- ---------------------------------------------------------------------
-- 4. Service requests: stock refills, vehicle defects, equipment, issues
--    (shared: every staff member can see them, to avoid duplicates)
-- ---------------------------------------------------------------------
create table if not exists public.service_requests (
  id                 bigint generated always as identity primary key,
  created_at         timestamptz not null default now(),
  requested_by       text default auth.user_id(),
  requester_name     text,
  kind               text not null check (kind in ('stock', 'vehicle_defect', 'equipment', 'issue')),
  station_code       text references public.stations (code),
  title              text not null check (length(trim(title)) > 0),
  item               text,          -- vehicle, equipment or stock item
  quantity           text,
  details            text,
  urgency            text not null default 'normal' check (urgency in ('normal', 'urgent')),
  status             text not null default 'open' check (status in ('open', 'in_progress', 'done', 'declined')),
  status_note        text,
  updated_at         timestamptz,
  updated_by         text,
  closed_at          timestamptz,
  notified_at        timestamptz,
  notify_claimed_at  timestamptz,
  notify_error       text
);

create index if not exists service_requests_status_idx on public.service_requests (status, created_at desc);

create or replace function public.guard_service_request()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  p public.profiles;
begin
  if auth.user_id() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select * into p from public.profiles where id = auth.user_id() and active;
    if not found then raise exception 'No active profile'; end if;
    new.requested_by := p.id;
    new.requester_name := coalesce(nullif(trim(p.full_name), ''), p.email);
    new.created_at := now();
    new.status := 'open';
    new.status_note := null; new.updated_at := null; new.updated_by := null; new.closed_at := null;
    new.notified_at := null; new.notify_claimed_at := null; new.notify_error := null;
    return new;
  end if;

  -- Updates: management, or a station lead for one of their stations.
  if not (public.is_management()
          or (public.my_role() = 'station_lead' and old.station_code = any (public.my_stations()))) then
    raise exception 'Only management or the station lead can update this request';
  end if;

  if (to_jsonb(new) - array['status', 'status_note', 'updated_at', 'updated_by', 'closed_at',
                            'notified_at', 'notify_claimed_at', 'notify_error'])
     is distinct from
     (to_jsonb(old) - array['status', 'status_note', 'updated_at', 'updated_by', 'closed_at',
                            'notified_at', 'notify_claimed_at', 'notify_error']) then
    raise exception 'Only the status and status note can be changed';
  end if;

  new.updated_at := now();
  new.updated_by := auth.user_id();
  if new.status in ('done', 'declined') and old.status not in ('done', 'declined') then
    new.closed_at := now();
  elsif new.status not in ('done', 'declined') then
    new.closed_at := null;
  end if;
  return new;
end;
$$;

create or replace trigger guard_service_request
  before insert or update on public.service_requests
  for each row execute function public.guard_service_request();


-- ---------------------------------------------------------------------
-- 5. Permissions and access rules
-- ---------------------------------------------------------------------
alter table public.rosters          enable row level security;
alter table public.credentials      enable row level security;
alter table public.leave_requests   enable row level security;
alter table public.service_requests enable row level security;

revoke all on public.rosters, public.credentials, public.leave_requests, public.service_requests from authenticated;
grant select, insert, delete         on public.rosters          to authenticated;
grant select, insert, update, delete on public.credentials      to authenticated;
grant select, insert, update         on public.leave_requests   to authenticated;
grant select, insert, update         on public.service_requests to authenticated;
grant usage, select on all sequences in schema public           to authenticated;

-- Roster
drop policy if exists "Staff can see the roster" on public.rosters;
create policy "Staff can see the roster"
  on public.rosters for select to authenticated
  using (public.my_role() is not null);

drop policy if exists "Management can upload the roster" on public.rosters;
create policy "Management can upload the roster"
  on public.rosters for insert to authenticated
  with check (public.is_management());

drop policy if exists "Management can remove old rosters" on public.rosters;
create policy "Management can remove old rosters"
  on public.rosters for delete to authenticated
  using (public.is_management());

-- Passes & certificates
drop policy if exists "People see their own passes" on public.credentials;
create policy "People see their own passes"
  on public.credentials for select to authenticated
  using (profile_id = auth.user_id());

drop policy if exists "Management sees all passes" on public.credentials;
create policy "Management sees all passes"
  on public.credentials for select to authenticated
  using (public.is_management());

drop policy if exists "People add their own passes" on public.credentials;
create policy "People add their own passes"
  on public.credentials for insert to authenticated
  with check ((profile_id = auth.user_id() and public.my_role() is not null) or public.is_management());

drop policy if exists "People edit their own passes" on public.credentials;
create policy "People edit their own passes"
  on public.credentials for update to authenticated
  using (profile_id = auth.user_id() or public.is_management())
  with check (profile_id = auth.user_id() or public.is_management());

drop policy if exists "People remove their own passes" on public.credentials;
create policy "People remove their own passes"
  on public.credentials for delete to authenticated
  using (profile_id = auth.user_id() or public.is_management());

-- Leave
drop policy if exists "People see their own leave" on public.leave_requests;
create policy "People see their own leave"
  on public.leave_requests for select to authenticated
  using (profile_id = auth.user_id());

drop policy if exists "Management sees all leave" on public.leave_requests;
create policy "Management sees all leave"
  on public.leave_requests for select to authenticated
  using (public.is_management());

drop policy if exists "Staff can request leave" on public.leave_requests;
create policy "Staff can request leave"
  on public.leave_requests for insert to authenticated
  with check (profile_id = auth.user_id() and public.my_role() is not null);

drop policy if exists "Leave can be updated by its owner or management" on public.leave_requests;
create policy "Leave can be updated by its owner or management"
  on public.leave_requests for update to authenticated
  using (profile_id = auth.user_id() or public.is_management())
  with check (profile_id = auth.user_id() or public.is_management());

-- Service requests
drop policy if exists "Staff can see service requests" on public.service_requests;
create policy "Staff can see service requests"
  on public.service_requests for select to authenticated
  using (public.my_role() is not null);

drop policy if exists "Staff can raise service requests" on public.service_requests;
create policy "Staff can raise service requests"
  on public.service_requests for insert to authenticated
  with check (public.my_role() is not null);

drop policy if exists "Management and station leads can update service requests" on public.service_requests;
create policy "Management and station leads can update service requests"
  on public.service_requests for update to authenticated
  using (public.is_management() or (public.my_role() = 'station_lead' and station_code = any (public.my_stations())))
  with check (public.is_management() or (public.my_role() = 'station_lead' and station_code = any (public.my_stations())));
