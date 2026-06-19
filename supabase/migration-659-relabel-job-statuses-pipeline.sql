-- migration-659-relabel-job-statuses-pipeline.sql
-- ===========================================================================
-- Issue #720 (PRD #719, ADR 0022) — relabel the Job lifecycle to the pipeline
-- Lead → Active → Collections → Closed → Lost as a DISPLAY-ONLY change.
--
-- The five snake_case status keys are FROZEN (ADR 0022): new / in_progress /
-- pending_invoice / completed / cancelled stay exactly as they are. No
-- jobs.status data is migrated; the ~12 key-based code sites (phone, Jarvis,
-- margins, dashboard, the unread-threads RLS view) are untouched. Only the
-- per-org job_statuses DISPLAY columns change:
--   new             New             -> Lead
--   in_progress     In Progress     -> Active
--   pending_invoice Pending Invoice -> Collections
--   completed       Completed       -> Closed
--   cancelled       Cancelled       -> Lost 😢  (+ muted rose so it no longer
--                                                looks identical to grey Closed)
--
-- Scope: ONLY the Nookleus-provided global defaults — the rows seeded in
-- migration-build14c.sql with organization_id IS NULL (see migration-build44,
-- Bucket D). An organization's own custom status rows (organization_id set)
-- are never touched. Colors mirror src/lib/job-status-presentation.ts, the
-- code-side source of truth; new/in_progress/pending_invoice/completed keep
-- their existing palette, only cancelled (Lost) recolors to rose.
--
-- sort_order already runs 1..5 in pipeline order from the original seed; it is
-- restated here so the migration is a complete statement of the desired end
-- state. The Jobs-page stage GROUPING order (Active first) is a UI concern
-- handled separately (issue #723), not this row ordering.
--
-- Depends on: migration-build14c (job_statuses + the 5 seeded defaults),
--             migration-build43/44/45 (organization_id column, defaults LEFT NULL).
-- Idempotent: re-running sets the same end state.
-- ===========================================================================

update public.job_statuses set display_label = 'Lead',        bg_color = '#FAEEDA', text_color = '#633806', sort_order = 1 where organization_id is null and name = 'new';
update public.job_statuses set display_label = 'Active',       bg_color = '#E1F5EE', text_color = '#085041', sort_order = 2 where organization_id is null and name = 'in_progress';
update public.job_statuses set display_label = 'Collections',  bg_color = '#EEEDFE', text_color = '#3C3489', sort_order = 3 where organization_id is null and name = 'pending_invoice';
update public.job_statuses set display_label = 'Closed',       bg_color = '#F1EFE8', text_color = '#5F5E5A', sort_order = 4 where organization_id is null and name = 'completed';
update public.job_statuses set display_label = 'Lost 😢',      bg_color = '#FBEAEA', text_color = '#9B2C2C', sort_order = 5 where organization_id is null and name = 'cancelled';

-- VERIFY (run after applying) ---
-- select name, display_label, bg_color, text_color, sort_order
--   from public.job_statuses
--  where organization_id is null
--  order by sort_order;
-- Expect: new=Lead, in_progress=Active, pending_invoice=Collections,
--         completed=Closed (#F1EFE8/#5F5E5A), cancelled=Lost 😢 (#FBEAEA/#9B2C2C).

-- ROLLBACK ---
-- update public.job_statuses set display_label = 'New',             bg_color = '#FAEEDA', text_color = '#633806', sort_order = 1 where organization_id is null and name = 'new';
-- update public.job_statuses set display_label = 'In Progress',     bg_color = '#E1F5EE', text_color = '#085041', sort_order = 2 where organization_id is null and name = 'in_progress';
-- update public.job_statuses set display_label = 'Pending Invoice', bg_color = '#EEEDFE', text_color = '#3C3489', sort_order = 3 where organization_id is null and name = 'pending_invoice';
-- update public.job_statuses set display_label = 'Completed',       bg_color = '#F1EFE8', text_color = '#5F5E5A', sort_order = 4 where organization_id is null and name = 'completed';
-- update public.job_statuses set display_label = 'Cancelled',       bg_color = '#F1EFE8', text_color = '#5F5E5A', sort_order = 5 where organization_id is null and name = 'cancelled';
