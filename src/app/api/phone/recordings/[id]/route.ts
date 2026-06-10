import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { canManage } from "@/lib/phone/phone-event-access";
import { createTwilioClient, deleteRecording } from "@/lib/phone/twilio-client";
import { PHONE_RECORDINGS_BUCKET } from "@/lib/phone/recordings-storage";

// PRD #304 — Nookleus Phone. Slice 11 (#315) — delete a call recording.
//
// DELETE /api/phone/recordings/[id]
//
// Flow (mirrors the voicemail delete route — Twilio first, DB second):
//   1. Look up the recording via the Service client (RLS bypassed). A
//      recording carries no kind/owner of its own, so resolve the parent
//      call → conversation → phone_number to learn them.
//   2. Run `canManage` against the (caller, number): Shared is admin-only,
//      Personal is owner-or-admin (ADR 0005). Cross-org callers are denied as
//      404 (privacy-preserving); wrong role inside the org is 403.
//   3. Twilio first: hard-delete the recording (PRD #304 story 54 — Nookleus
//      owns retention). A transient Twilio error returns 502 and leaves the DB
//      row untouched (admin retries). The reverse — row gone, recording still
//      on Twilio — silently strands a recording, so we refuse to touch the DB
//      until Twilio confirms. deleteRecording is idempotent on an already-gone
//      SID (Twilio 404). A recording with no twilio_recording_sid (demo /
//      already gone) skips the Twilio hop.
//   4. Delete the phone_recordings row, then best-effort drop the stored MP3.

interface RecordingRow {
  id: string;
  organization_id: string;
  phone_call_id: string;
  twilio_recording_sid: string | null;
  audio_storage_path: string | null;
}

interface CallRow {
  id: string;
  organization_id: string;
  conversation_id: string;
}

interface ConversationRow {
  id: string;
  organization_id: string;
  phone_number_id: string;
}

interface PhoneNumberRow {
  id: string;
  organization_id: string;
  kind: "shared" | "personal";
  user_id: string | null;
}

export const DELETE = withRequestContext(
  { permission: "view_phone", serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const { data: rec } = await ctx.serviceClient!
      .from("phone_recordings")
      .select(
        "id, organization_id, phone_call_id, twilio_recording_sid, audio_storage_path",
      )
      .eq("id", id)
      .maybeSingle<RecordingRow>();
    if (!rec || rec.organization_id !== ctx.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Resolve the number kind / owner so canManage can apply the ADR 0005
    // matrix: recording → call → conversation → number.
    const { data: call } = await ctx.serviceClient!
      .from("phone_calls")
      .select("id, organization_id, conversation_id")
      .eq("id", rec.phone_call_id)
      .maybeSingle<CallRow>();
    if (!call) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { data: conv } = await ctx.serviceClient!
      .from("phone_conversations")
      .select("id, organization_id, phone_number_id")
      .eq("id", call.conversation_id)
      .maybeSingle<ConversationRow>();
    if (!conv) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { data: num } = await ctx.serviceClient!
      .from("phone_numbers")
      .select("id, organization_id, kind, user_id")
      .eq("id", conv.phone_number_id)
      .maybeSingle<PhoneNumberRow>();
    if (!num) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const allowed = canManage(
      {
        userId: ctx.userId,
        organizationId: ctx.orgId ?? "",
        role: ctx.role,
      },
      {
        kind: num.kind,
        organizationId: num.organization_id,
        userId: num.user_id,
      },
    );
    if (!allowed) {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    }

    // Twilio first. A null sid (demo recording / already gone) skips the hop.
    if (rec.twilio_recording_sid) {
      try {
        await deleteRecording(createTwilioClient(), rec.twilio_recording_sid);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Twilio error";
        return NextResponse.json(
          { error: `Twilio: ${message}` },
          { status: 502 },
        );
      }
    }

    const { error } = await ctx.serviceClient!
      .from("phone_recordings")
      .delete()
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Best-effort: drop the Nookleus storage copy so a deleted recording leaves
    // no playable audio. The row is already gone and Twilio's recording is
    // hard-deleted, so a storage hiccup here is cosmetic (orphaned object in a
    // private bucket, no row to sign it). Don't let it fail the request.
    if (rec.audio_storage_path) {
      try {
        await ctx.serviceClient!.storage
          .from(PHONE_RECORDINGS_BUCKET)
          .remove([rec.audio_storage_path]);
      } catch {
        // swallow — orphaned object, retryable out-of-band
      }
    }

    return NextResponse.json({ ok: true });
  },
);
