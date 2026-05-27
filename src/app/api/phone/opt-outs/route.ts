import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// PRD #304 — Nookleus Phone. Slice 5 (#309).
//
// GET /api/phone/opt-outs — list the active org's opt-out registry. The
// User-client RLS from migration-309 already filters cross-org rows;
// this route is a thin pass-through. Used by Settings → Phone admin view.

const FIELDS =
  "id, organization_id, outside_e164, opted_out_at, re_opted_in_at, re_opted_in_note, re_opted_in_by_user_id, created_at, updated_at";

export const GET = withRequestContext(
  { permission: "view_phone" },
  async (_request, ctx) => {
    const { data, error } = await ctx.supabase
      .from("phone_opt_outs")
      .select(FIELDS)
      .eq("organization_id", ctx.orgId ?? "")
      .order("opted_out_at", { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  },
);
