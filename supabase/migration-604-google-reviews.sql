-- issue #604 (parent PRD #603) — the Google reviews inbox.
--
-- The Marketing Suite's reviews slice (ADR 0015): a scheduled poll pulls the
-- Organization's Google Business Profile reviews into this Organization-scoped
-- table, tracking replied/unreplied state, so the Marketing area can list them
-- with the unreplied ones flagged. Reviews live only in the legacy My Business
-- v4 API; the sync runs through the deep module's authorized client
-- (src/lib/google/client.ts) and src/lib/google/reviews.ts. No tokens land here.
--
-- Trust shape: per-Organization, admin-only, mirroring google_connection (#615).
-- Three things make this table what it is:
--
--   1. ONE ROW PER (org, Google review) — uniq_google_review_org_review. The
--      sync UPSERTS on this key, so re-running a poll updates each review in
--      place and never duplicates or regresses its state. This is the
--      idempotency contract the acceptance criteria require.
--
--   2. `replied` derived from the review's reply on Google (mapReviewToRow sets
--      it from the presence of reviewReply). The inbox flags unreplied reviews
--      off this column. A CHECK keeps an unreplied row from carrying stale reply
--      text (see google_review_reply_consistency).
--
--   3. ADMIN-ONLY RLS, org-scoped — the same google_connection_admin shape on
--      active_organization_id(), because Marketing is an admin surface.
--
-- This table references organizations only, NOT google_connection: disconnecting
-- (which deletes the connection row) simply stops the sync; already-pulled
-- reviews stay visible until the next sync or until the org itself is deleted.
--
-- Depends on: schema.sql (organizations, user_organizations,
--             nookleus.active_organization_id(), update_updated_at()),
--             migration-615-google-connection.sql (the connection it syncs from).
--
-- Smoke test: supabase/migration-604-smoke-test.sql.
--
-- Revert:    see -- ROLLBACK --- block at the bottom.

-- ---------------------------------------------------------------------------
-- google_review — one synced Google Business Profile review for an Organization.
-- ---------------------------------------------------------------------------
create table if not exists public.google_review (
  id                  uuid primary key default gen_random_uuid(),
  -- The owning Organization. CASCADE so deleting an org takes its reviews with
  -- it — there is no cross-org value in retaining them.
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  -- Google's stable review id (reviewId on the v4 payload). Unique per org with
  -- organization_id below; the sync upserts on that pair.
  google_review_id    text not null,
  -- The v4 location resource name the review came from
  -- ("accounts/*/locations/*"). A connection may cover several locations.
  location_name       text not null,
  -- Reviewer display fields. Null for anonymous / star-only reviews.
  reviewer_name       text,
  reviewer_photo_url  text,
  -- 1..5, or 0 when Google reports the rating unspecified/unknown
  -- (starRatingToInt maps the ONE..FIVE word enum onto this).
  star_rating         smallint not null default 0
                        check (star_rating between 0 and 5),
  -- The review body. Null for a star-only review.
  comment             text,
  -- When Google says the review was created / last updated (its createTime /
  -- updateTime). Nullable — a payload may omit them.
  review_created_at   timestamptz,
  review_updated_at   timestamptz,
  -- Replied/unreplied state, derived from the review's reply on Google. The
  -- inbox flags `replied = false`. reply_comment / reply_updated_at carry the
  -- owner's reply when one exists.
  replied             boolean not null default false,
  reply_comment       text,
  reply_updated_at    timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- An UNREPLIED row must carry no reply text — otherwise the inbox could show a
  -- reply on something it flags as needing one. The reverse is not forced: a
  -- replied row may legitimately lack stored reply text, so this stays one-sided
  -- and the upsert payload from mapReviewToRow always satisfies it.
  constraint google_review_reply_consistency
    check (replied or (reply_comment is null and reply_updated_at is null))
);

-- One row per (Organization, Google review): the sync's upsert conflict target.
-- A re-poll overwrites the existing row instead of stacking a duplicate.
create unique index if not exists uniq_google_review_org_review
  on public.google_review (organization_id, google_review_id);

-- Serves the inbox listing: an Organization's reviews, unreplied first, newest
-- first. (false sorts before true, so plain `replied` ordering floats unreplied
-- to the top.)
create index if not exists idx_google_review_org_inbox
  on public.google_review (organization_id, replied, review_created_at desc);

create trigger trg_google_review_updated_at
  before update on public.google_review
  for each row execute function update_updated_at();

alter table public.google_review enable row level security;

-- Admin-only, org-scoped. Same shape as google_connection_admin: membership
-- alone is not enough — uo.role must be 'admin'. The service-role sync bypasses
-- RLS; this policy backstops the User client behind the Marketing inbox.
create policy google_review_admin
  on public.google_review for all to authenticated
  using (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = google_review.organization_id
         and uo.role = 'admin'
    )
  )
  with check (
    organization_id is not null
    and organization_id = nookleus.active_organization_id()
    and exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = google_review.organization_id
         and uo.role = 'admin'
    )
  );

-- ROLLBACK ---
-- drop policy if exists google_review_admin on public.google_review;
-- drop trigger if exists trg_google_review_updated_at on public.google_review;
-- drop index if exists public.idx_google_review_org_inbox;
-- drop index if exists public.uniq_google_review_org_review;
-- drop table if exists public.google_review;
