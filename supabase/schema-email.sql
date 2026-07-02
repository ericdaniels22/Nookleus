-- ============================================
-- AAA Disaster Recovery — Email System Schema
-- Run this in the Supabase SQL Editor
-- ============================================
--
-- Multi-tenancy note: every table below carries `organization_id`
-- (uuid NOT NULL, FK -> organizations) for per-tenant isolation, added by the
-- Build 42–58 multi-tenancy work. These objects assume the core multi-tenant
-- schema already exists — the `organizations` and `user_organizations` tables
-- and the `nookleus.active_organization_id()` / `nookleus.is_member_of()`
-- helpers — plus `jobs`, `auth.users`, and `update_updated_at()`. Run the core
-- schema first.
--
-- RLS note: unlike the photo tables, the email family does NOT use one uniform
-- `tenant_isolation_*` policy. Each table mirrors what production actually
-- enforces today:
--   • email_accounts     — shared-vs-personal (ADR 0001 / migration-140,
--                          tightened to admin-only shared INSERT in #222)
--   • emails             — visibility tracks the parent email_account
--   • email_attachments  — visibility tracks the parent email
--   • email_folder_state — straight per-tenant isolation
--   • email_signatures   — straight per-tenant isolation
-- The CREATE POLICY blocks near the bottom reproduce each one faithfully.

-- ============================================
-- 1. EMAIL ACCOUNTS
-- IMAP/SMTP connection settings. A Shared account has user_id IS NULL and is
-- visible to Org members who hold the email permission; a Personal account is
-- owned by user_id (migration-140).
-- ============================================
CREATE TABLE email_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  email_address text NOT NULL,
  imap_host text NOT NULL DEFAULT 'imap.hostinger.com',
  imap_port integer NOT NULL DEFAULT 993,
  smtp_host text NOT NULL DEFAULT 'smtp.hostinger.com',
  smtp_port integer NOT NULL DEFAULT 465,
  username text NOT NULL,
  encrypted_password text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz,
  last_synced_uid integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  display_name text NOT NULL DEFAULT 'AAA Disaster Recovery',
  provider text NOT NULL DEFAULT 'hostinger',
  is_default boolean NOT NULL DEFAULT false,
  signature text,
  category_backfill_completed_at timestamptz,                   -- one-time inbox-categorization backfill marker
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  color text,                                                   -- per-account accent color (migration-build69)
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE      -- NULL = Shared account; set = Personal owner (migration-140)
);

-- ============================================
-- 2. EMAILS
-- Synced mail (renamed from job_emails). job_id is now nullable — an email need
-- not be matched to a Job — and mail is organized by `folder` rather than the
-- old inbound/outbound `direction`. Recipients are jsonb arrays of
-- {email, name?} (the EmailAddress shape in src/lib/types.ts).
-- ============================================
CREATE TABLE emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  message_id text NOT NULL,
  thread_id text,
  folder text NOT NULL DEFAULT 'inbox'
    CHECK (folder IN ('inbox', 'sent', 'drafts', 'trash', 'archive', 'spam', 'other')),
  from_address text NOT NULL,
  from_name text,
  to_addresses jsonb NOT NULL DEFAULT '[]',
  cc_addresses jsonb NOT NULL DEFAULT '[]',
  bcc_addresses jsonb NOT NULL DEFAULT '[]',
  subject text NOT NULL DEFAULT '',
  body_text text,
  body_html text,
  snippet text,
  is_read boolean NOT NULL DEFAULT false,
  is_starred boolean NOT NULL DEFAULT false,
  has_attachments boolean NOT NULL DEFAULT false,
  matched_by text
    CHECK (matched_by IN ('contact', 'claim_number', 'address', 'job_id', 'manual')),
  uid integer,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  category text DEFAULT 'general',                              -- inbox categorization; free text in prod (no CHECK)
  category_locked boolean NOT NULL DEFAULT false,               -- #957: a manual move wins; skip in backfill + sender-rule re-file
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT
);

-- ============================================
-- 3. EMAIL ATTACHMENTS
-- ============================================
CREATE TABLE email_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id uuid NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  filename text NOT NULL,
  content_type text,
  file_size integer,
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT
);

-- ============================================
-- 4. EMAIL FOLDER STATE
-- Per-account IMAP sync cursor (one row per account + folder). No surrogate
-- key — the natural key (account_id, folder) is the primary key.
-- ============================================
CREATE TABLE email_folder_state (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  folder text NOT NULL,
  imap_path text NOT NULL,
  uid_validity bigint NOT NULL,
  last_uid_seen bigint NOT NULL,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, folder)
);

-- ============================================
-- 5. EMAIL SIGNATURES
-- One signature per account (UNIQUE account_id).
-- ============================================
CREATE TABLE email_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  signature_html text NOT NULL DEFAULT '',
  include_logo boolean NOT NULL DEFAULT true,
  auto_insert boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  UNIQUE (account_id)
);

-- ============================================
-- AUTO-UPDATE updated_at TIMESTAMPS
-- (Only email_accounts and email_signatures carry an updated_at column.)
-- ============================================
CREATE TRIGGER trg_email_accounts_updated_at
  BEFORE UPDATE ON email_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_email_signatures_updated_at
  BEFORE UPDATE ON email_signatures FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY (multi-tenant isolation)
-- See the RLS note in the header: the five policies below are NOT uniform.
-- Each reproduces what production enforces today.
-- ============================================
ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_folder_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_signatures ENABLE ROW LEVEL SECURITY;

-- email_accounts — Shared vs Personal (ADR 0001 / migration-140; shared INSERT
-- tightened to admins in #222). A row is visible/editable when it is in the
-- caller's active Organization AND either it is Shared (user_id IS NULL) and
-- the caller belongs to that Org, or it is the caller's own Personal account.
-- Creating or updating a Shared account additionally requires the caller be an
-- admin of the Org.
CREATE POLICY email_accounts_shared_or_personal ON email_accounts
  FOR ALL
  USING (
    organization_id = nookleus.active_organization_id()
    AND (
      (user_id IS NULL AND nookleus.is_member_of(organization_id))
      OR user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id = nookleus.active_organization_id()
    AND (
      (
        user_id IS NULL
        AND nookleus.is_member_of(organization_id)
        AND EXISTS (
          SELECT 1 FROM user_organizations uo
          WHERE uo.user_id = auth.uid()
            AND uo.organization_id = email_accounts.organization_id
            AND uo.role = 'admin'
        )
      )
      OR user_id = auth.uid()
    )
  );

-- emails — visibility tracks the parent email_account: a row is reachable when
-- its account is. The account policy above is what scopes to the tenant; emails
-- ride on it.
CREATE POLICY emails_track_parent_account ON emails
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM email_accounts ea WHERE ea.id = emails.account_id)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM email_accounts ea WHERE ea.id = emails.account_id)
  );

-- email_attachments — visibility tracks the parent email (which in turn tracks
-- its account).
CREATE POLICY email_attachments_track_parent_email ON email_attachments
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM emails e WHERE e.id = email_attachments.email_id)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM emails e WHERE e.id = email_attachments.email_id)
  );

-- email_folder_state — straight per-tenant isolation.
CREATE POLICY tenant_isolation_email_folder_state ON email_folder_state
  FOR ALL
  USING (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid()
        AND uo.organization_id = email_folder_state.organization_id
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid()
        AND uo.organization_id = email_folder_state.organization_id
    )
  );

-- email_signatures — straight per-tenant isolation.
CREATE POLICY tenant_isolation_email_signatures ON email_signatures
  FOR ALL
  USING (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid()
        AND uo.organization_id = email_signatures.organization_id
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM user_organizations uo
      WHERE uo.user_id = auth.uid()
        AND uo.organization_id = email_signatures.organization_id
    )
  );

-- ============================================
-- INDEXES
-- ============================================
-- email_accounts
CREATE INDEX idx_email_accounts_organization_id ON email_accounts(organization_id);
CREATE INDEX idx_email_accounts_user_id ON email_accounts(user_id) WHERE user_id IS NOT NULL;

-- emails
CREATE INDEX idx_emails_account_id ON emails(account_id);
CREATE INDEX idx_emails_category ON emails(category);
CREATE INDEX idx_emails_folder ON emails(folder);
CREATE INDEX idx_emails_is_read ON emails(is_read) WHERE is_read = false;
CREATE INDEX idx_emails_is_starred ON emails(is_starred) WHERE is_starred = true;
CREATE INDEX idx_emails_job_id ON emails(job_id);
CREATE INDEX idx_emails_message_id ON emails(message_id);
CREATE INDEX idx_emails_organization_id ON emails(organization_id);
CREATE INDEX idx_emails_received_at ON emails(received_at DESC);
CREATE INDEX idx_emails_thread_id ON emails(thread_id);

-- Per-tenant dedup: one stored copy of a message per (org, message, account, folder)
CREATE UNIQUE INDEX emails_org_dedup_key ON emails(organization_id, message_id, account_id, folder);

-- email_attachments
CREATE INDEX idx_email_attachments_email_id ON email_attachments(email_id);
CREATE INDEX idx_email_attachments_organization_id ON email_attachments(organization_id);

-- email_folder_state
CREATE INDEX idx_email_folder_state_org ON email_folder_state(organization_id);

-- email_signatures (idx_email_signatures_account_id is redundant with the
-- UNIQUE(account_id) constraint but is present in prod, so it is kept here too)
CREATE INDEX idx_email_signatures_account_id ON email_signatures(account_id);
CREATE INDEX idx_email_signatures_organization_id ON email_signatures(organization_id);
