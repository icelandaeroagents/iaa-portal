-- =====================================================================
-- Iceland Aero Agents – Staff Portal
-- Update 09: weekly briefings, with "Mark as read"
--
-- Run AFTER 08-access-requests.sql: SQL Editor → paste all → Run.
-- Then: Data API page → "Refresh schema cache".
--
-- Every active staff member can read every briefing. Only management
-- can publish, replace or delete one. Read confirmations replace the
-- Signatures table: staff confirm for themselves, management sees all.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Briefings
-- ---------------------------------------------------------------------
create table public.briefings (
  id            bigint generated always as identity primary key,
  issue_no      int  not null unique check (issue_no > 0),
  issue_date    date not null,
  title         text not null default 'IAA’s (Not so weekly) Briefing',
  sections      text[] not null default '{}',          -- headings, for summaries
  html          text not null check (length(html) between 1 and 6000000),
  docx          text check (docx is null or length(docx) < 8000000),  -- original Word file, base64
  docx_name     text,
  source        text not null default 'upload' check (source in ('upload', 'automation')),
  published_at  timestamptz not null default now(),
  published_by  text default auth.user_id(),
  updated_at    timestamptz
);

create index briefings_latest_idx on public.briefings (issue_no desc);

-- Who published or replaced it is always whoever is signed in.
create or replace function public.fill_briefing()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.user_id() is not null then
    new.published_by := auth.user_id();
    new.source       := 'upload';
  end if;
  if tg_op = 'UPDATE' then
    new.published_at := old.published_at;
    new.updated_at   := now();
  else
    new.published_at := now();
    new.updated_at   := null;
  end if;
  return new;
end;
$$;

create trigger fill_briefing
  before insert or update on public.briefings
  for each row execute function public.fill_briefing();


-- ---------------------------------------------------------------------
-- 2. Read confirmations
-- ---------------------------------------------------------------------
create table public.briefing_reads (
  briefing_id  bigint not null references public.briefings (id) on delete cascade,
  profile_id   text   not null references public.profiles (id) on delete cascade,
  read_at      timestamptz not null default now(),
  primary key (briefing_id, profile_id)
);

create or replace function public.fill_briefing_read()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.user_id() is not null then
    new.profile_id := auth.user_id();
    new.read_at    := now();
  end if;
  return new;
end;
$$;

create trigger fill_briefing_read
  before insert on public.briefing_reads
  for each row execute function public.fill_briefing_read();


-- ---------------------------------------------------------------------
-- 3. Permissions and access rules
-- ---------------------------------------------------------------------
alter table public.briefings      enable row level security;
alter table public.briefing_reads enable row level security;

revoke all on public.briefings, public.briefing_reads from authenticated;
grant select, insert, update, delete on public.briefings      to authenticated;
grant select, insert                 on public.briefing_reads to authenticated;
grant usage, select on all sequences in schema public         to authenticated;

create policy "Staff can read briefings"
  on public.briefings for select to authenticated
  using (public.my_role() is not null);

create policy "Management can publish briefings"
  on public.briefings for insert to authenticated
  with check (public.is_management());

create policy "Management can replace briefings"
  on public.briefings for update to authenticated
  using (public.is_management())
  with check (public.is_management());

create policy "Management can delete briefings"
  on public.briefings for delete to authenticated
  using (public.is_management());

create policy "Staff can confirm they read a briefing"
  on public.briefing_reads for insert to authenticated
  with check (profile_id = auth.user_id() and public.my_role() is not null);

create policy "Staff see their own confirmations"
  on public.briefing_reads for select to authenticated
  using (profile_id = auth.user_id());

create policy "Management sees all confirmations"
  on public.briefing_reads for select to authenticated
  using (public.is_management());
