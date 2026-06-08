import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// PRD #304 — Nookleus Phone. Slice 8 (#312) — thread call history.
//
// Returns every voice call in the named conversation, sorted by
// `started_at` ascending (chronological). The Phone-tab thread fetches this
// alongside /messages and interleaves the two via mergeThreadItems, so a
// call and a text to the same outside number render inline.
//
// Additive: a separate endpoint from /messages so the slice-4 thread route
// is untouched. RLS (migration-312) enforces the ADR 0003 matrix; the route
// is a thin pass-through — a caller who cannot see a row simply doesn't get
// it back.
//
// Slice 9 (#313) — each call also embeds its voicemail (recording +
// transcript). The embed runs under the same User-client RLS, so a row the
// caller can't see is simply absent. PostgREST returns the embed as an array
// keyed off the child FK; since phone_voicemails is UNIQUE per call we
// flatten it to a single `voicemail | null` for the client.

const FIELDS =
  "id, organization_id, conversation_id, direction, from_e164, to_e164, twilio_call_sid, status, duration_seconds, job_tag, tagged_by_user_id, initiated_by_user_id, started_at, ended_at, created_at, phone_voicemails(id, audio_storage_path, transcript, transcript_status, duration_seconds)";

// Flatten PostgREST's embed array (0-or-1 row, UNIQUE per call) into a single
// `voicemail` field, dropping the raw embed key.
function flattenVoicemail(row: Record<string, unknown>): Record<string, unknown> {
  const { phone_voicemails, ...call } = row as {
    phone_voicemails?: unknown;
  } & Record<string, unknown>;
  const voicemail = Array.isArray(phone_voicemails)
    ? (phone_voicemails[0] ?? null)
    : (phone_voicemails ?? null);
  return { ...call, voicemail };
}

export const GET = withRequestContext(
  { permission: "view_phone" },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const { data, error } = await ctx.supabase
      .from("phone_calls")
      .select(FIELDS)
      .eq("conversation_id", id)
      .order("started_at", { ascending: true });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const calls = ((data ?? []) as Record<string, unknown>[]).map(
      flattenVoicemail,
    );
    return NextResponse.json(calls);
  },
);
