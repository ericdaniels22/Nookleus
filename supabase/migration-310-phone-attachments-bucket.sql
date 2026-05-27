-- Issue #310 — Phone slice 6 — MMS attachments (inbound + outbound).
--
-- Adds the private `phone-attachments` Storage bucket. Both outbound MMS
-- (a Crew Lead drops a photo into the compose box → upload → Twilio
-- fetches the signed URL) and inbound MMS (Twilio's webhook carries
-- MediaUrlN → fetch → re-upload into our own bucket) share this one
-- bucket. The attachment references are kept inline in
-- `phone_messages.media_urls` JSONB (no separate `phone_attachments`
-- table — slice 4 of PRD #304 reserved `media_urls` for exactly this).
--
-- Object paths: {organization_id}/{uuid}.{ext}
--
-- All I/O — upload, signed-URL generation, and conversation-prefix delete
-- — runs through the /api/phone/attachments and /api/phone/messages
-- routes on the Service client, which bypasses RLS. The read policy
-- below is Organization-scoped defense-in-depth: even a direct client
-- read can only see objects under the caller's Active Organization
-- prefix. Mirrors the `jarvis-attachments` bucket (migration-198).

-- 1. Storage bucket (private; signed URLs only).
INSERT INTO storage.buckets (id, name, public)
VALUES ('phone-attachments', 'phone-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- 2. Organization-scoped read policy. The first path segment is the
-- organization id; a member may read only objects under their own
-- Active Organization prefix.
CREATE POLICY "phone_attachments_org_members_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'phone-attachments'
    AND (storage.foldername(name))[1] = nookleus.active_organization_id()::text
  );
