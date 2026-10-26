-- =====================================================================
-- Iceland Aero Agents – Staff Portal
-- Update 11: management can delete reports
-- SAFE TO RUN AGAIN.
--
-- Run AFTER 10-staff-tools.sql: SQL Editor → paste all → Run.
-- Then: Data API page → "Refresh schema cache".
--
-- Deleting a report also deletes its photos, notes and reporter link
-- (they are linked with "on delete cascade"). The portal records each
-- deletion in the audit log before it happens.
-- =====================================================================

grant delete on public.reports to authenticated;

drop policy if exists "Management can delete reports" on public.reports;
create policy "Management can delete reports"
  on public.reports for delete to authenticated
  using (public.is_management());
