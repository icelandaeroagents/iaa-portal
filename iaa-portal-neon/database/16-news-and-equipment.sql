-- =====================================================================
-- Iceland Aero Agents – Staff Portal
-- Update 16: News and Equipment Info
-- SAFE TO RUN AGAIN.
--
-- Run AFTER 15-roster-names.sql: SQL Editor → paste all → Run.
-- Then: Data API page → "Refresh schema cache".
--
-- News: everyone reads; management posts, edits and deletes.
-- Equipment: everyone reads; management, and station leads for their own
-- stations, add, edit and remove equipment.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. News
-- ---------------------------------------------------------------------
create table if not exists public.news_posts (
  id             bigint generated always as identity primary key,
  title          text not null check (length(trim(title)) > 0),
  body           text not null default '',
  station_codes  text[] not null default '{}',   -- empty = everyone
  pinned         boolean not null default false,
  created_at     timestamptz not null default now(),
  created_by     text default auth.user_id(),
  author_name    text,
  updated_at     timestamptz,
  updated_by     text
);

create index if not exists news_posts_latest_idx on public.news_posts (pinned desc, created_at desc);

create or replace function public.fill_news_post()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  p public.profiles;
begin
  if auth.user_id() is not null then
    select * into p from public.profiles where id = auth.user_id();
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    if auth.user_id() is not null then
      new.created_by := auth.user_id();
      new.author_name := coalesce(nullif(trim(p.full_name), ''), p.email);
    end if;
    new.updated_at := null;
    new.updated_by := null;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.author_name := old.author_name;
    new.updated_at := now();
    new.updated_by := auth.user_id();
  end if;
  return new;
end;
$$;

create or replace trigger fill_news_post
  before insert or update on public.news_posts
  for each row execute function public.fill_news_post();


-- ---------------------------------------------------------------------
-- 2. Equipment Info
-- ---------------------------------------------------------------------
create table if not exists public.equipment (
  id               bigint generated always as identity primary key,
  station_code     text not null references public.stations (code),
  name             text not null check (length(trim(name)) > 0),
  category         text not null default 'other'
                     check (category in ('gpu', 'tug', 'towbar', 'stairs', 'vehicle', 'lavatory_water',
                                         'safety', 'tools', 'other')),
  location         text,
  notes            text,
  status           text not null default 'in_service' check (status in ('in_service', 'out_of_service')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       text,
  updated_by_name  text
);

create index if not exists equipment_station_idx on public.equipment (station_code, category, name);

create or replace function public.fill_equipment()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  p public.profiles;
begin
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  new.updated_at := now();
  if auth.user_id() is not null then
    select * into p from public.profiles where id = auth.user_id();
    new.updated_by := auth.user_id();
    new.updated_by_name := coalesce(nullif(trim(p.full_name), ''), p.email);
  end if;
  return new;
end;
$$;

create or replace trigger fill_equipment
  before insert or update on public.equipment
  for each row execute function public.fill_equipment();


-- ---------------------------------------------------------------------
-- 3. Permissions and access rules
-- ---------------------------------------------------------------------
alter table public.news_posts enable row level security;
alter table public.equipment  enable row level security;

revoke all on public.news_posts, public.equipment from authenticated;
grant select, insert, update, delete on public.news_posts to authenticated;
grant select, insert, update, delete on public.equipment  to authenticated;
grant usage, select on all sequences in schema public     to authenticated;

-- News
drop policy if exists "Staff can read news" on public.news_posts;
create policy "Staff can read news"
  on public.news_posts for select to authenticated
  using (public.my_role() is not null);

drop policy if exists "Management can post news" on public.news_posts;
create policy "Management can post news"
  on public.news_posts for insert to authenticated
  with check (public.is_management());

drop policy if exists "Management can edit news" on public.news_posts;
create policy "Management can edit news"
  on public.news_posts for update to authenticated
  using (public.is_management())
  with check (public.is_management());

drop policy if exists "Management can delete news" on public.news_posts;
create policy "Management can delete news"
  on public.news_posts for delete to authenticated
  using (public.is_management());

-- Equipment
drop policy if exists "Staff can read equipment" on public.equipment;
create policy "Staff can read equipment"
  on public.equipment for select to authenticated
  using (public.my_role() is not null);

drop policy if exists "Management and station leads can add equipment" on public.equipment;
create policy "Management and station leads can add equipment"
  on public.equipment for insert to authenticated
  with check (public.is_management()
              or (public.my_role() = 'station_lead' and station_code = any (public.my_stations())));

drop policy if exists "Management and station leads can edit equipment" on public.equipment;
create policy "Management and station leads can edit equipment"
  on public.equipment for update to authenticated
  using (public.is_management()
         or (public.my_role() = 'station_lead' and station_code = any (public.my_stations())))
  with check (public.is_management()
              or (public.my_role() = 'station_lead' and station_code = any (public.my_stations())));

drop policy if exists "Management and station leads can remove equipment" on public.equipment;
create policy "Management and station leads can remove equipment"
  on public.equipment for delete to authenticated
  using (public.is_management()
         or (public.my_role() = 'station_lead' and station_code = any (public.my_stations())));
