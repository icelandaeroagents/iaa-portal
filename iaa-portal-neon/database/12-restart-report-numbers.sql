-- =====================================================================
-- Iceland Aero Agents – Staff Portal
-- OPTIONAL: restart report numbers after deleting the test reports
--
-- Run this only AFTER the test reports have been deleted in the portal.
-- The next report gets the number after the highest one still there,
-- so with no reports left the next one is R-0001. Existing reports keep
-- their numbers. Safe to run again.
-- =====================================================================

do $$
declare
  next_no bigint;
begin
  select coalesce(max(id), 0) + 1 into next_no from public.reports;
  execute format('alter table public.reports alter column id restart with %s', next_no);
  raise notice 'The next report will be R-%', lpad(next_no::text, 4, '0');
end $$;
