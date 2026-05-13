-- Build 69: per-account color indicator for multi-account inbox.
--
-- When the user has 2+ active email accounts connected, every email row in
-- the inbox renders a 3px-wide colored bar at its left edge identifying
-- which account it belongs to. Hidden when only one active account exists.
--
-- Backfill rule: within each organization, the first account by created_at
-- gets the Nookleus brand green (#0F6E56). Subsequent accounts cycle
-- through blue, amber, violet, rose. A sixth+ account falls back to gray.
-- This same palette is owned by assignAccountColor() at the app layer and
-- runs on every new-account insert; the backfill below makes existing rows
-- agree with the same fixed order.
--
-- Stored as plain text rather than enum so future palette additions or
-- user-picked hex overrides don't need a schema change.
--
-- No RLS update needed — email_accounts already has tenant_isolation
-- (build49), and "color" is org-scoped via the existing organization_id.

ALTER TABLE public.email_accounts
  ADD COLUMN IF NOT EXISTS color text;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id
      ORDER BY created_at, id
    ) AS rn
  FROM public.email_accounts
  WHERE color IS NULL
)
UPDATE public.email_accounts ea
SET color = CASE (SELECT rn FROM ranked WHERE ranked.id = ea.id) - 1
  WHEN 0 THEN '#0F6E56'  -- Nookleus brand green
  WHEN 1 THEN '#2563EB'  -- blue-600
  WHEN 2 THEN '#D97706'  -- amber-600
  WHEN 3 THEN '#7C3AED'  -- violet-600
  WHEN 4 THEN '#E11D48'  -- rose-600
  ELSE        '#6B7280'  -- gray-500 fallback
END
WHERE ea.color IS NULL;

-- ROLLBACK ---
-- ALTER TABLE public.email_accounts DROP COLUMN IF EXISTS color;
