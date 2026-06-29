-- issue #609 (PRD #603, ADR 0015) — Showcase → Google Business Profile publish
-- state.
--
-- Purpose:   The GBP slice of the Marketing Suite — "the free channel". #606
--            added the WordPress publish columns; this migration adds the
--            PER-CHANNEL columns the Business Profile publish writes, kept
--            SEPARATE from the website columns so the two channels publish
--            INDEPENDENTLY (AC#3): a Showcase can be live on the Business Profile
--            while still a website draft, and vice versa.
--
--              • gbp_post_name — the remote LocalPost resource name
--                (accounts/*/locations/*/localPosts/*) recorded on first publish,
--                so editing a published Showcase re-pushes the SAME post
--                (publishShowcaseGbpPost passes it back in as the update target) —
--                never a duplicate update on the profile. NULL = never posted to
--                GBP, which is exactly what deriveShowcaseGbpPublishState reads as
--                the GBP "draft" state.
--              • gbp_post_url — the live post searchUrl, for the "View on Google"
--                link.
--              • gbp_published_at — when the Showcase was last successfully pushed
--                to the Business Profile. NULL = never.
--
--            The one-click consent audit (consent_confirmed_by / _at, added in
--            #606) is SHARED: a GBP publish re-affirms and re-stamps the same
--            consent the website publish does — it is the same customer-OK gate
--            (AC#4), not a per-channel one.
--
-- Trust shape: additive and idempotent (ADD COLUMN IF NOT EXISTS). RLS is
--            unchanged — the showcases_admin_only policy (#613) already governs
--            every column, and these are admin-only writes like the rest.
--
-- Depends on: migration-613-showcases.sql (the table),
--            migration-606-showcase-publish.sql (the shared consent columns).
--
-- Revert:    see the ROLLBACK block at the bottom.

alter table public.showcases
  -- The remote Business Profile LocalPost this Showcase maps to, set on first
  -- publish and reused on every re-push so an edit updates one post instead of
  -- stacking a duplicate. NULL = never posted to GBP (the channel's draft state).
  add column if not exists gbp_post_name     text,
  -- The live post URL (LocalPost `searchUrl`), for the "View on Google" link.
  add column if not exists gbp_post_url      text,
  -- When the Showcase was last successfully pushed to the Business Profile.
  -- NULL = never published to GBP.
  add column if not exists gbp_published_at  timestamptz;

-- ROLLBACK ---
-- alter table public.showcases
--   drop column if exists gbp_published_at,
--   drop column if exists gbp_post_url,
--   drop column if exists gbp_post_name;
