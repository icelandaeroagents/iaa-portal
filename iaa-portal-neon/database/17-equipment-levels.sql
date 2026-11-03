-- =====================================================================
-- Iceland Aero Agents – Staff Portal
-- Update 17: equipment types, levels and comments
-- SAFE TO RUN AGAIN.
--
-- Run AFTER 16-news-and-equipment.sql: SQL Editor → paste all → Run.
-- Then: Data API page → "Refresh schema cache".
--
-- – Equipment types become free text, so management can add any type
--   (the portal suggests Lav Unit, Water Unit, GPU, Tug, Air Stairs and any
--   types already in use). Older built-in types get readable names.
-- – Each item chooses which levels to track: battery, fuel, tank.
-- – Anyone can log a level check and/or a comment for an item. Entries
--   are kept as a history; people can remove their own, management any.
-- =====================================================================


-- 1. Equipment types: free text, so management can add any type.
--    Older built-in types are turned into readable names.
alter table public.equipment drop constraint if exists equipment_category_check;

update public.equipment
   set category = case category
                    when 'lav_unit'       then 'Lav Unit'
                    when 'water_unit'     then 'Water Unit'
                    when 'gpu'            then 'GPU'
                    when 'tug'            then 'Tug'
                    when 'air_stairs'     then 'Air Stairs'
                    when 'stairs'         then 'Air Stairs'
                    when 'lavatory_water' then 'Lav Unit'
                    when 'towbar'         then 'Tow Bar'
                    when 'vehicle'        then 'Vehicle'
                    when 'safety'         then 'Safety Equipment'
                    when 'tools'          then 'Tools'
                    when 'other'          then 'Other'
                    else category
                  end;

update public.equipment set category = left(trim(category), 40);

alter table public.equipment
  add constraint equipment_category_check
  check (length(trim(category)) between 1 and 40);

alter table public.equipment alter column category set default 'GPU';


-- 2. Levels each item tracks
alter table public.equipment add column if not exists levels text[] not null default '{}';
alter table public.equipment drop constraint if exists equipment_levels_check;
alter table public.equipment
  add constraint equipment_levels_check
  check (levels <@ array['battery', 'fuel', 'tank']::text[]);


-- 3. Level checks and comments
create table if not exists public.equipment_logs (
  id            bigint generated always as identity primary key,
  equipment_id  bigint not null references public.equipment (id) on delete cascade,
  battery_pct   int check (battery_pct between 0 and 100),
  fuel_pct      int check (fuel_pct between 0 and 100),
  tank_pct      int check (tank_pct between 0 and 100),
  comment       text,
  created_at    timestamptz not null default now(),
  created_by    text default auth.user_id(),
  author_name   text,
  check (battery_pct is not null or fuel_pct is not null or tank_pct is not null
         or length(trim(coalesce(comment, ''))) > 0)
);

create index if not exists equipment_logs_item_idx on public.equipment_logs (equipment_id, created_at desc);

create or replace function public.fill_equipment_log()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  p public.profiles;
begin
  new.created_at := now();
  if auth.user_id() is not null then
    select * into p from public.profiles where id = auth.user_id();
    new.created_by := auth.user_id();
    new.author_name := coalesce(nullif(trim(p.full_name), ''), p.email);
  end if;
  new.comment := nullif(trim(coalesce(new.comment, '')), '');
  return new;
end;
$$;

create or replace trigger fill_equipment_log
  before insert on public.equipment_logs
  for each row execute function public.fill_equipment_log();

alter table public.equipment_logs enable row level security;
revoke all on public.equipment_logs from authenticated;
grant select, insert, delete on public.equipment_logs to authenticated;
grant usage, select on all sequences in schema public to authenticated;

drop policy if exists "Staff can read equipment logs" on public.equipment_logs;
create policy "Staff can read equipment logs"
  on public.equipment_logs for select to authenticated
  using (public.my_role() is not null);

drop policy if exists "Staff can log equipment checks" on public.equipment_logs;
create policy "Staff can log equipment checks"
  on public.equipment_logs for insert to authenticated
  with check (public.my_role() is not null);

drop policy if exists "People remove their own entries, management any" on public.equipment_logs;
create policy "People remove their own entries, management any"
  on public.equipment_logs for delete to authenticated
  using (created_by = auth.user_id() or public.is_management());
