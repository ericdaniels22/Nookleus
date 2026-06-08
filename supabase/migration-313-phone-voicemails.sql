-- issue #313 (PRD #304, ADR 0005) — phone_voicemails + phone-recordings
-- Storage bucket.
--
-- Purpose:   The voicemail table for Nookleus Phone. One row per voicemail
--            recording left when an inbound call falls through to the
--            <Record> verb (a Personal number always voicemails; a Shared
--            number voicemails when its inbound rule resolves to voicemail).
--            The voicemail-completed webhook inserts the row at
--            recording-end (transcript_status='pending'), keyed to its
--            parent phone_calls row via Twilio's CallSid; the
--            transcription-completed webhook later fills `transcript` and
--            flips `transcript_status` to 'ready' (or 'failed').
--
--            The recording audio is copied out of Twilio into the
--            org-scoped `phone-recordings` Storage bucket so playback
--            outlives Twilio's media retention and deletion is under
--            Nookleus's control (PRD #304 story 54). audio_storage_path is
--            that Nookleus-hosted copy; twilio_recording_url is the original
--            Twilio URL (kept for provenance / re-fetch).
--
-- Shape:     One voicemail per call — UNIQUE(phone_call_id). A single
--            <Record> verb yields exactly one recording, so the parent call
--            is the natural key. twilio_recording_sid is stored (not just
--            the URL) so the delete path can hard-delete on Twilio by SID
--            without parsing it back out of the URL. No updated_at / update
--            trigger — like phone_calls and phone_messages, a voicemail
--            row's lifecycle is webhook-written status transitions, not a
--            generic updated_at. transcript is NULL until the transcription
--            webhook lands; transcript_status drives the UI (pending →
--            spinner, ready → text, failed → "transcript unavailable").
--
-- RLS:       phone_voicemails SELECT DELEGATES to phone_calls visibility: a
--            voicemail is visible exactly when its PARENT call is. The policy
--            is `organization_id = active_organization_id() AND EXISTS(select 1
--            from phone_calls call where call.id = phone_call_id)` — and
--            because RLS DOES apply to phone_calls inside a policy subquery,
--            that EXISTS is true iff phone_calls_select admits the parent call.
--            So the full ADR 0005 matrix (Shared tagged/untagged team-visible,
--            Personal owner-visible, Job-tagged visible to whoever can see the
--            Job) is INHERITED from phone_calls_select rather than restated —
--            and self-heals when that policy changes.
--
--            Do NOT re-express the matrix here by joining phone_numbers /
--            phone_conversations and nesting the job_tag test inside that
--            join's WHERE. RLS filters the Personal number + conversation rows
--            out of the subquery for a non-owner, so the join comes back empty
--            and the nested job_tag escape hatch never fires — a Job-tagged
--            Personal voicemail would be wrongly hidden from the team (the
--            migration-313 smoke test pins exactly this). phone_calls_select
--            avoids the trap by lifting job_tag to a TOP-LEVEL OR branch that
--            never touches the number join; delegation inherits that fix for
--            free. Like phone_calls the policy does NOT check view_phone — the
--            feature gate is applied at the route via withRequestContext.
--
--            There is no authenticated INSERT / UPDATE / DELETE policy.
--            Every write path is the Service client: the voicemail-completed
--            and transcription-completed webhooks (no auth user) and the
--            canManage-gated DELETE route (serviceClient: true, mirroring
--            numbers/[id]/release). RLS is ENABLED so the table is otherwise
--            locked — the only user-facing path is the SELECT join the
--            conversation Calls route issues on the User client.
--
-- Indexes:   UNIQUE(phone_call_id) doubles as the lookup index for the
--            conversation Calls route's nested embed and the
--            voicemail-completed insert's conflict target.
--            idx_phone_voicemails_twilio_recording_sid — the
--            transcription-completed webhook looks a row up by RecordingSid
--            to attach the transcript; partial on non-null sid.
--
-- Bucket:    phone-recordings — a private Storage bucket, org-prefixed
--            ({organization_id}/{uuid}.{ext}), mirroring phone-attachments
--            (migration-310). Its own bucket (not phone-attachments) so
--            voice recordings carry their own retention lifecycle (PRD #304
--            story 54) and slice-11 call recordings reuse it. The read
--            policy is Organization-scoped defense-in-depth: even a direct
--            client read sees only objects under the caller's Active
--            Organization prefix. All real I/O runs through the
--            recordings-storage helpers on the Service client.
--
-- Depends on: schema.sql (organizations, jobs), migration-308
--            (phone_conversations), migration-312 (phone_calls),
--            `nookleus.active_organization_id()`, and
--            migration-313-fix-phone-event-select-job-tag-visibility.sql
--            (the smoke test below asserts the lifted Job-tag visibility
--            branch on phone_calls_select; apply that fix first). NB: this
--            file shares the `migration-313-` prefix with that fix — they are
--            independent migrations, apply both.
--
-- Smoke test: supabase/migration-313-smoke-test.sql exercises every cell of
--            the ADR 0005 matrix on phone_voicemails through the parent
--            call, mirroring migration-312-smoke-test.sql.
--
-- Revert:    see -- ROLLBACK -- block at the bottom.

-- ---------------------------------------------------------------------------
-- 1. phone_voicemails. One row per voicemail recording, on a phone_calls row.
-- ---------------------------------------------------------------------------
create table if not exists public.phone_voicemails (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  -- The voicemail's parent call. UNIQUE: one voicemail per call (a single
  -- <Record> verb yields one recording). on delete cascade — a voicemail
  -- has no meaning without its call.
  phone_call_id         uuid not null references public.phone_calls(id) on delete cascade,
  -- Twilio's RecordingSid. The delete path hard-deletes the recording on
  -- Twilio by this SID; the transcription-completed webhook keys on it to
  -- attach the transcript.
  twilio_recording_sid  text,
  -- The original Twilio media URL (provenance / re-fetch). Playback uses the
  -- Nookleus-hosted copy below, not this.
  twilio_recording_url  text,
  -- The Nookleus-hosted copy in the phone-recordings bucket
  -- ({organization_id}/{uuid}.{ext}). NULL if the copy failed (the row still
  -- persists — see the voicemail-completed webhook).
  audio_storage_path    text,
  -- Recording length in seconds (Twilio's RecordingDuration).
  duration_seconds      integer,
  -- The transcript text. NULL until the transcription-completed webhook
  -- lands (or permanently NULL on a failed transcription).
  transcript            text,
  -- Drives the UI. 'pending' at insert; the transcription webhook flips it
  -- to 'ready' (transcript filled) or 'failed' (transcript stays NULL).
  transcript_status     text not null default 'pending'
                          check (transcript_status in ('pending', 'ready', 'failed')),
  created_at            timestamptz not null default now(),
  unique (phone_call_id)
);

create index if not exists idx_phone_voicemails_twilio_recording_sid
  on public.phone_voicemails (twilio_recording_sid)
  where twilio_recording_sid is not null;

-- ---------------------------------------------------------------------------
-- 2. phone-recordings Storage bucket (private; signed URLs only). Mirrors
--    phone-attachments (migration-310). Object paths:
--    {organization_id}/{uuid}.{ext}
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('phone-recordings', 'phone-recordings', false)
on conflict (id) do nothing;

-- Organization-scoped read policy. The first path segment is the
-- organization id; a member may read only objects under their own Active
-- Organization prefix.
drop policy if exists "phone_recordings_org_members_read" on storage.objects;
create policy "phone_recordings_org_members_read"
  on storage.objects for select
  using (
    bucket_id = 'phone-recordings'
    and (storage.foldername(name))[1] = nookleus.active_organization_id()::text
  );

-- ---------------------------------------------------------------------------
-- 3. RLS. SELECT delegates to phone_calls visibility — a voicemail is visible
--    exactly when its parent call is (see the RLS note in the header for why
--    delegation rather than a restated OR-tree). No authenticated INSERT /
--    UPDATE / DELETE policy: every write is the Service client (webhooks + the
--    canManage-gated DELETE route).
-- ---------------------------------------------------------------------------
alter table public.phone_voicemails enable row level security;

drop policy if exists phone_voicemails_select on public.phone_voicemails;
create policy phone_voicemails_select on public.phone_voicemails
  for select to authenticated
  using (
    -- Fast org guard / defense-in-depth: the voicemail's own org must match the
    -- caller's Active Organization.
    organization_id = nookleus.active_organization_id()
    -- Inherit the parent call's visibility. RLS applies to phone_calls inside
    -- this subquery, so the EXISTS is true iff phone_calls_select admits the
    -- parent call — the whole Shared/Personal/Job matrix, one hop out.
    and exists (
      select 1
        from public.phone_calls call
       where call.id = phone_voicemails.phone_call_id
    )
  );

-- ROLLBACK ---
-- drop policy if exists phone_voicemails_select on public.phone_voicemails;
-- alter table public.phone_voicemails disable row level security;
-- drop policy if exists "phone_recordings_org_members_read" on storage.objects;
-- delete from storage.buckets where id = 'phone-recordings';
-- drop index if exists public.idx_phone_voicemails_twilio_recording_sid;
-- drop table if exists public.phone_voicemails;
