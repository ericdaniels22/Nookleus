-- issue #606 (PRD #603, ADR 0015) — Showcase → WordPress publish state.
--
-- Purpose:   Slice ③ of the Marketing Suite. #613 created the showcases table as
--            DRAFTS only, deliberately leaving publishing unmodelled "beyond
--            leaving 'published' valid in the status check". This migration adds
--            the columns publishing writes:
--
--              • the remote WordPress post (id + live URL) recorded on first
--                publish, so editing a published Showcase re-pushes the SAME post
--                (publishShowcasePost passes wordpress_post_id back in) — never a
--                duplicate; and
--              • the one-click consent audit — WHO confirmed "I have the
--                customer's OK to show these photos" and WHEN. Consent is
--                re-affirmed on every publish (each push reflects the current
--                photos), so these hold the most recent affirmation.
--
--            published_at stamps the last successful push. The existing `status`
--            check already allows 'published'; the publish route flips status to
--            'published' alongside these columns in one update.
--
-- Trust shape: additive and idempotent (ADD COLUMN IF NOT EXISTS). RLS is
--            unchanged — the showcases_admin_only policy (#613) already governs
--            every column, and these are admin-only writes like the rest.
--
-- Provider-neutral id: wordpress_post_id is `text`, not a WordPress integer, so
--            the column survives a future second publish target (GBP, #603)
--            without a type change — the publisher stringifies the remote id.
--
-- Depends on: migration-613-showcases.sql (the table), auth.users.
--
-- Smoke test: supabase/migration-606-smoke-test.sql.
--
-- Revert:    see the ROLLBACK block at the bottom.

alter table public.showcases
  -- The remote WordPress post this Showcase maps to, set on first publish and
  -- reused on every re-push so an edit updates one post instead of duplicating.
  -- NULL = never published. Text (not int) to stay provider-neutral.
  add column if not exists wordpress_post_id  text,
  -- The live post URL (WordPress `link`), for the "View live post" link.
  add column if not exists wordpress_post_url text,
  -- When the Showcase was last successfully pushed live. NULL = never published.
  add column if not exists published_at       timestamptz,
  -- The one-click photo-consent audit: who affirmed it and when. SET NULL on the
  -- author so the record survives that user being removed. Re-stamped on every
  -- publish, so it reflects the most recent affirmation against the live photos.
  add column if not exists consent_confirmed_by uuid
    references auth.users(id) on delete set null,
  add column if not exists consent_confirmed_at timestamptz;

-- ROLLBACK ---
-- alter table public.showcases
--   drop column if exists consent_confirmed_at,
--   drop column if exists consent_confirmed_by,
--   drop column if exists published_at,
--   drop column if exists wordpress_post_url,
--   drop column if exists wordpress_post_id;
