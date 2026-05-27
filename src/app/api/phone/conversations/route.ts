import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// PRD #304 — Nookleus Phone. Slice 4 (#308) — list conversations.
//
// Returns every Conversation visible to the caller in their active org,
// sorted by `last_event_at` desc. RLS (migration-308) does the heavy
// lifting: cross-org rows hidden, Personal-number-untagged rows hidden
// from non-owners, etc. The route is a thin pass-through.

const FIELDS =
  "id, organization_id, phone_number_id, outside_e164, contact_id, last_event_at, unread_count, deleted_at, created_at, updated_at";

export const GET = withRequestContext(
  { permission: "view_phone" },
  async (_request, ctx) => {
    const { data, error } = await ctx.supabase
      .from("phone_conversations")
      .select(FIELDS)
      .eq("organization_id", ctx.orgId ?? "")
      .order("last_event_at", { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  },
);
