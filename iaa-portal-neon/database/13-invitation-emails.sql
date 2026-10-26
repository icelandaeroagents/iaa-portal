-- =====================================================================
-- Iceland Aero Agents – Staff Portal
-- Update 13: invitation emails
-- SAFE TO RUN AGAIN.
--
-- Run AFTER 12 (or 11): SQL Editor → paste all → Run.
-- Then: Data API page → "Refresh schema cache".
--
-- Tracks the invitation email for each invited person. Invitations that
-- are still waiting (including ones made before this update) are emailed
-- by api/staff-notify.js within 10 minutes; each is sent once, and
-- management can resend from the People page.
-- =====================================================================

alter table public.invitations add column if not exists invite_sent_at    timestamptz;
alter table public.invitations add column if not exists invite_claimed_at timestamptz;
alter table public.invitations add column if not exists invite_error      text;
alter table public.invitations add column if not exists invite_attempts   int not null default 0;
