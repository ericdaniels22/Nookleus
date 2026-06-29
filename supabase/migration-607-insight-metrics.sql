-- issue #607 (parent PRD #603) — the Insights metrics store.
--
-- The Marketing Suite's Insights foundation (ADR 0015): a daily scheduled sync
-- pulls each Organization's Google Business Profile performance (calls, direction
-- requests, website clicks) and Search Console (clicks, impressions) into this
-- Organization-scoped table, so the Insights screen can show both sources with
-- day-level history — not just a snapshot. The sync runs through the deep
-- module's authorized client (src/lib/google/client.ts) and src/lib/insights/.
-- No tokens land here.
--
-- LONG / NARROW shape — ONE ROW PER NUMBER, PER DAY. Every measurement is a row
-- tagged with the `source` it came from and the `metric_date` it is for. Three
-- things make this table what it is:
--
--   1. ONE ROW PER (org, source, day, metric) — uniq_insight_metric. The sync
--      UPSERTS on this key, so re-running a day's pull overwrites each
--      measurement in place and never duplicates. Google revises recent days for
--      a while and the sync's window overlaps prior runs; the upsert absorbs that
--      cleanly. This is the idempotency contract the acceptance criteria require.
--
--   2. `source` and `metric` are FREE TEXT, not a CHECK-constrained enum, on
--      purpose: later slices (Google Ads, Local Services Ads, cost-per-lead) add
--      new `source` / `metric` values WITHOUT any schema change. The controlled
--      vocabulary lives in the application (InsightMetricSource), not the column.
--
--   3. ADMIN-ONLY RLS, org-scoped — the same google_review_admin / google_connection_admin
--      shape on active_organization_id(), because Marketing is an admin surface.
--      The service-role sync bypasses RLS and scopes by org explicitly.
--
-- This table references organizations only, NOT google_connection: disconnecting
-- (which deletes the connection row) simply stops the sync; already-pulled
-- metrics stay visible until the org itself is deleted.
--
-- Depends on: schema.sql (organizations, user_organizations,
--             nookleus.active_organization_id(), update_updated_at()).
--
-- Smoke test: supabase/migration-607-smoke-test.sql.
--
-- Revert:    see -- ROLLBACK --- block at the bottom.

-- ---------------------------------------------------------------------------
-- insight_metric — one dated, source-tagged measurement for an Organization.
-- ---------------------------------------------------------------------------
create table if not exists public.insight_metric (
  id                  uuid primary key default gen_random_uuid(),
  -- The owning Organization. CASCADE so deleting an org takes its metrics with
  -- it — there is no cross-org value in retaining them.
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  -- Which integration the number came from ("business_profile", "search_console",
  -- and later "google_ads", "local_services_ads", ...). Free text by design —
  -- see header note 2.
  source              text not null,
  -- The day the measurement is for.
  metric_date         date not null,
  -- The measurement name, scoped by source ("calls", "direction_requests",
  -- "website_clicks", "clicks", "impressions", ...). Free text by design.
  metric              text not null,
  -- The measured value. numeric (not integer) so later cost / ratio metrics
  -- (cost-per-lead) fit without a schema change; the counts in this slice are
  -- whole numbers. Non-negative — every metric in scope is a count or a cost.
  value               numeric not null default 0 check (value >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One row per (Organization, source, day, metric): the sync's upsert conflict
-- target (see upsertInsightMetrics). A re-pull overwrites the existing row
-- instead of stacking a duplicate. Because organization_id is the leftmost
-- column, this index also serves the org-scoped Insights read.
create unique index if not exists uniq_insight_metric
  on public.insight_metric (organization_id, source, metric_date, metric);

-- Serves the Insights screen's day-level history read: an Organization's metrics
-- in chronological order.
create index if not exists idx_insight_metric_org_history
  on public.insight_metric (organization_id, metric_date);

create trigger trg_insight_metric_updated_at
  before update on public.insight_metric
  for each row execute function update_updated_at();

alter table public.insight_metric enable row level security;

-- Admin-only, org-scoped. Same shape as google_review_admin: membership alone is
-- not enough — uo.role must be 'admin'. The service-role sync bypasses RLS; this
-- policy backstops the User client behind the Insights screen.
create policy insight_metric_admin
  on public.insight_metric for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = insight_metric.organization_id
         and uo.role = 'admin'
    )
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = insight_metric.organization_id
         and uo.role = 'admin'
    )
  );

-- ROLLBACK ---
-- drop policy if exists insight_metric_admin on public.insight_metric;
-- drop trigger if exists trg_insight_metric_updated_at on public.insight_metric;
-- drop index if exists public.idx_insight_metric_org_history;
-- drop index if exists public.uniq_insight_metric;
-- drop table if exists public.insight_metric;
