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

const FIELDS =
  "id, organization_id, conversation_id, direction, from_e164, to_e164, twilio_call_sid, status, duration_seconds, job_tag, tagged_by_user_id, initiated_by_user_id, started_at, ended_at, created_at";

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
    return NextResponse.json(data ?? []);
  },
);
