-- Build 69: per-(account, folder) UID bookmark for incremental email sync.
--
-- Today /api/email/sync refetches the last 100 messages by sequence number
-- for every folder on every run and drops the ones we already have. This
-- table lets each (account, folder) pair remember the highest IMAP UID it
-- has ingested and the mailbox's UIDVALIDITY at the time of that ingest.
-- The new sync algorithm asks the server "UIDs greater than last_uid_seen"
-- instead of pulling 100 and dedup'ing in app memory.
--
-- imap_path stores the raw IMAP path we opened (e.g. "[Gmail]/Sent Mail")
-- so reopening the right mailbox doesn't depend on folder-discovery order
-- being stable across syncs. The normalized name (inbox, sent, drafts...)
-- is the primary-key half so application code never sees raw paths.
--
-- UIDVALIDITY mismatch is treated as silent bootstrap recovery — the row
-- is wiped and the folder re-bootstraps. A structured warning is logged
-- with prefix [email-sync] for ops visibility. Not user-visible.
--
-- RLS pattern mirrors tenant_isolation_email_accounts in build49:
--   organization_id is not null
--   and organization_id = nookleus.active_organization_id()
--   and exists (select 1 from user_organizations ...)
-- so this table integrates with the same active-org session helper that
-- every other email_* table uses.

CREATE TABLE IF NOT EXISTS public.email_folder_state (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  folder text NOT NULL,
  imap_path text NOT NULL,
  uid_validity bigint NOT NULL,
  last_uid_seen bigint NOT NULL,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, folder)
);

CREATE INDEX IF NOT EXISTS idx_email_folder_state_org
  ON public.email_folder_state(organization_id);

ALTER TABLE public.email_folder_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_email_folder_state ON public.email_folder_state;
CREATE POLICY tenant_isolation_email_folder_state ON public.email_folder_state
  FOR ALL TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM public.user_organizations uo
      WHERE uo.user_id = auth.uid()
        AND uo.organization_id = email_folder_state.organization_id
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM public.user_organizations uo
      WHERE uo.user_id = auth.uid()
        AND uo.organization_id = email_folder_state.organization_id
    )
  );

-- ROLLBACK ---
-- DROP POLICY IF EXISTS tenant_isolation_email_folder_state ON public.email_folder_state;
-- DROP INDEX IF EXISTS public.idx_email_folder_state_org;
-- DROP TABLE IF EXISTS public.email_folder_state;
