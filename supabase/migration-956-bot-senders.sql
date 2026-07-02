-- ============================================
-- Issue #956 Migration: Bot senders (automated-mail identities)
-- Run this in the Supabase SQL Editor
-- ============================================
--
-- A "bot sender" is an automated-mail identity — the display-name + address
-- PAIR (ADR 0028). vercel[bot] and "GitHub CI" both send from
-- notifications@github.com yet stay separate senders, so the identity is the
-- pair, not the address alone. Detection is auto (classifier + one-time
-- backfill) with room for future manual entries; presentation-only — the
-- inbox collapses a sender's unread mail into a Sender group and drains its
-- read mail to "Older updates". No message-store schema change.

-- 1. One-time per-account bot-sender backfill marker (mirrors
--    category_backfill_completed_at). NULL until the backfill has run.
ALTER TABLE email_accounts ADD COLUMN bot_backfill_completed_at timestamptz;

-- 2. Org-scoped bot-sender registry.
--    identity = (display_name, address); display_name defaults to '' (never
--    NULL) so the UNIQUE key is clean and matches an email with no from_name.
--    address is stored lowercased by the app (exact-match identity).
CREATE TABLE bot_senders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  address text NOT NULL,
  provenance text NOT NULL DEFAULT 'auto' CHECK (provenance IN ('auto', 'manual')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, display_name, address)
);

-- 3. Indexes.
CREATE INDEX idx_bot_senders_organization_id ON bot_senders(organization_id);
-- Active-sender lookup for the inbox grouping query (per org).
CREATE INDEX idx_bot_senders_active ON bot_senders(organization_id) WHERE is_active = true;

-- 4. RLS — straight per-tenant isolation (mirrors email_signatures /
--    email_folder_state).
ALTER TABLE bot_senders ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_bot_senders ON bot_senders
  FOR ALL
  USING (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid()
        AND uo.organization_id = bot_senders.organization_id
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid()
        AND uo.organization_id = bot_senders.organization_id
    )
  );
