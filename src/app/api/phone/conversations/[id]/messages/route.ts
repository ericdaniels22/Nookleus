import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// PRD #304 — Nookleus Phone. Slice 4 (#308) — thread render.
//
// Returns every message in the named conversation, sorted by `sent_at`
// ascending (chronological). RLS (migration-308) enforces the ADR 0003
// matrix; the route is a thin pass-through. A caller who cannot see a
// row simply does not get it back.

const FIELDS =
  "id, organization_id, conversation_id, direction, from_e164, to_e164, body, media_urls, twilio_sid, status, job_tag, tagged_by_user_id, sent_by_user_id, sent_at, created_at";

export const GET = withRequestContext(
  { permission: "view_phone" },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const { data, error } = await ctx.supabase
      .from("phone_messages")
      .select(FIELDS)
      .eq("conversation_id", id)
      .order("sent_at", { ascending: true });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  },
);
