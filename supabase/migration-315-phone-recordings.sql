-- issue #315 (PRD #304, ADR 0005 + ADR 0006) — phone_recordings +
-- organizations.recording_enabled_default.
--
-- Purpose:   Call recording for Nookleus Phone. One row per recorded voice
--            call — the answered/bridged conversation, distinct from a
--            voicemail (which has its own phone_voicemails row). Every voice
--            call is auto-recorded by default with a legally-required consent
--            notice played at the start (PRD stories 38/39/40, ADR 0006). The
--            recording-completed webhook inserts the row at recording-end,
--            keyed to its parent phone_calls row via Twilio's CallSid, and
--            copies the audio out of Twilio into the org-scoped
--            `phone-recordings` Storage bucket (created by migration-313 and
--            REUSED here — NOT recreated) so playback outlives Twilio's media
--            retention and deletion is under Nookleus's control (PRD story 54).
--            audio_storage_path is that Nookleus-hosted copy;
--            twilio_recording_url is the original Twilio URL (provenance).
--
--            recording_enabled_default is the per-Organization toggle that
--            governs whether the consent <Say> + <Dial record> stanza is
--            emitted on inbound and outbound calls. Default TRUE (spec: every
--            voice call auto-records; the consent notice is the legal
--            mitigation). A per-call override on the outbound bridge route can
--            suppress recording for a single call.
--
-- Shape:     Mirrors phone_voicemails (migration-313) — the established
--            phone_calls-child shape: org FK, phone_call_id FK CASCADE,
--            twilio_recording_sid (so delete hard-deletes on Twilio by SID),
--            twilio_recording_url (provenance), audio_storage_path (the
--            Nookleus copy, NULL until/if the copy succeeds), duration_seconds,
--            created_at. UNIQUE(phone_call_id): one recording per call (a
--            single <Dial record> yields one recording), so the parent call is
--            the natural key and the recording-completed webhook's upsert
--            conflict target. Plus consent_notice_played — pinned TRUE by the
--            webhook (the notice always fires when recording is enabled; the
--            boolean is the audit-trail record, not a runtime gate). No
--            updated_at / update trigger — like phone_calls/phone_voicemails,
--            the lifecycle is webhook-written.
--
-- RLS:       phone_recordings SELECT DELEGATES to phone_calls visibility,
--            exactly like phone_voicemails_select: a recording is visible iff
--            its PARENT call is. `organization_id = active_organization_id()
--            AND EXISTS(select 1 from phone_calls call where call.id =
--            phone_call_id)` — RLS applies to phone_calls inside the subquery,
--            so the whole ADR-0005 Shared/Personal/Job matrix is INHERITED from
--            phone_calls_select and self-heals when that policy changes.
--
--            Do NOT re-express the matrix here by joining phone_numbers /
--            phone_conversations: RLS filters the Personal-number rows out of
--            the subquery for a non-owner, the join comes back empty, and the
--            nested job_tag escape hatch never fires — wrongly hiding a
--            Job-tagged Personal recording from the team (the migration-313
--            header documents this trap; migration-315-smoke-test.sql pins it).
--            Like phone_calls the policy does NOT check view_phone — the
--            feature gate is applied at the route via withRequestContext.
--
--            There is no authenticated INSERT / UPDATE / DELETE policy. Every
--            write path is the Service client: the recording-completed webhook
--            (no auth user) and the canManage-gated DELETE route
--            (serviceClient: true, mirroring voicemails/[id]). RLS is ENABLED
--            so the table is otherwise locked — the only user-facing path is
--            the SELECT embed the conversation Calls route issues on the User
--            client.
--
-- Indexes:   UNIQUE(phone_call_id) doubles as the lookup index for the
--            conversation Calls route's nested embed and the
--            recording-completed insert's conflict target.
--            idx_phone_recordings_twilio_recording_sid — partial on non-null
--            sid, for SID-keyed lookups.
--
-- Bucket:    REUSES the existing private `phone-recordings` Storage bucket
--            (created by migration-313, whose header anticipates this reuse).
--            This migration does NOT (re)create the bucket or its read policy —
--            call recordings land under the same {organization_id}/{uuid}.{ext}
--            path as voicemail audio and are signed through the same
--            /api/phone/recordings route.
--
-- Depends on: schema.sql (organizations), migration-312 (phone_calls),
--            migration-313 (the phone-recordings bucket), and
--            `nookleus.active_organization_id()`.
--
-- Smoke test: supabase/migration-315-smoke-test.sql exercises every cell of
--            the ADR 0005 matrix on phone_recordings through the parent call,
--            mirroring migration-313-smoke-test.sql.
--
-- Revert:    see -- ROLLBACK -- block at the bottom.

-- ---------------------------------------------------------------------------
-- 1. phone_recordings. One row per recorded call, on a phone_calls row.
-- ---------------------------------------------------------------------------
create table if not exists public.phone_recordings (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  -- The recording's parent call. UNIQUE: one recording per call (a single
  -- <Dial record> yields one recording). on delete cascade — a recording has
  -- no meaning without its call (PRD story 54: deleting the call removes it).
  phone_call_id         uuid not null references public.phone_calls(id) on delete cascade,
  -- Twilio's RecordingSid. The delete path hard-deletes the recording on
  -- Twilio by this SID.
  twilio_recording_sid  text,
  -- The original Twilio media URL (provenance / re-fetch). Playback uses the
  -- Nookleus-hosted copy below, not this.
  twilio_recording_url  text,
  -- The Nookleus-hosted copy in the phone-recordings bucket
  -- ({organization_id}/{uuid}.{ext}). NULL if the copy failed (the row still
  -- persists — see the recording-completed webhook).
  audio_storage_path    text,
  -- Recording length in seconds (Twilio's RecordingDuration).
  duration_seconds      integer,
  -- The legal-consent <Say> was played before recording began. Pinned TRUE by
  -- the recording-completed webhook (the notice fires unconditionally when
  -- recording is enabled); this column is the audit-trail record of that.
  consent_notice_played boolean not null default true,
  created_at            timestamptz not null default now(),
  unique (phone_call_id)
);

create index if not exists idx_phone_recordings_twilio_recording_sid
  on public.phone_recordings (twilio_recording_sid)
  where twilio_recording_sid is not null;

-- ---------------------------------------------------------------------------
-- 2. Per-Organization recording default. Governs whether inbound + outbound
--    calls emit the consent <Say> + <Dial record> stanza. Default TRUE: every
--    voice call auto-records (spec), with the consent notice as the legal
--    mitigation; a per-call override on the outbound bridge route can suppress
--    a single call. NOT NULL default backfills every existing org to TRUE.
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column if not exists recording_enabled_default boolean not null default true;

-- ---------------------------------------------------------------------------
-- 3. RLS. SELECT delegates to phone_calls visibility — a recording is visible
--    exactly when its parent call is (see the RLS note in the header for why
--    delegation rather than a restated OR-tree). No authenticated INSERT /
--    UPDATE / DELETE policy: every write is the Service client (the
--    recording-completed webhook + the canManage-gated DELETE route).
-- ---------------------------------------------------------------------------
alter table public.phone_recordings enable row level security;

drop policy if exists phone_recordings_select on public.phone_recordings;
create policy phone_recordings_select on public.phone_recordings
  for select to authenticated
  using (
    -- Fast org guard / defense-in-depth: the recording's own org must match
    -- the caller's Active Organization.
    organization_id = nookleus.active_organization_id()
    -- Inherit the parent call's visibility. RLS applies to phone_calls inside
    -- this subquery, so the EXISTS is true iff phone_calls_select admits the
    -- parent call — the whole Shared/Personal/Job matrix, one hop out.
    and exists (
      select 1
        from public.phone_calls call
       where call.id = phone_recordings.phone_call_id
    )
  );

-- ROLLBACK ---
-- drop policy if exists phone_recordings_select on public.phone_recordings;
-- alter table public.phone_recordings disable row level security;
-- alter table public.organizations drop column if exists recording_enabled_default;
-- drop index if exists public.idx_phone_recordings_twilio_recording_sid;
-- drop table if exists public.phone_recordings;
