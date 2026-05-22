-- Issue #198 — Chat attachments for Jarvis.
--
-- Adds the private `jarvis-attachments` Storage bucket. A user in Jarvis
-- Core can attach one image per message; the image is stored here and the
-- attachment reference is kept inline in `jarvis_conversations.messages`
-- JSONB (no `jarvis_attachments` table — keeps the conversation the single
-- source of truth).
--
-- Object paths: {organization_id}/{conversation_id}/{uuid}.{ext}
--
-- All I/O — upload, signed-URL generation, and conversation-prefix delete —
-- runs through the /api/jarvis/attachments and /api/jarvis/conversations
-- routes on the Service client, which bypasses RLS. The read policy below
-- is Organization-scoped defense-in-depth: even a direct client read can
-- only see objects under the caller's Active Organization prefix.

-- 1. Storage bucket (private; signed URLs only)
INSERT INTO storage.buckets (id, name, public)
VALUES ('jarvis-attachments', 'jarvis-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- 2. Organization-scoped read policy — mirrors the `pdfs` bucket (build67c1).
-- The first path segment is the organization id; a member may read only
-- objects under their own Active Organization prefix.
CREATE POLICY "jarvis_attachments_org_members_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'jarvis-attachments'
    AND (storage.foldername(name))[1] = nookleus.active_organization_id()::text
  );
