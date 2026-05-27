import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// PRD #304 — Nookleus Phone. Slice 5 (#309) — admin re-opt-in.
//
// POST /api/phone/opt-outs/[id]/re-opt-in
// Body: { note: string } — required. The note is the audit trail of WHY
// fresh consent was granted (per PRD AC #11).
//
// Admin-only. The Service-client write side-steps the User-client RLS
// admin-mutation policy from migration-309 — the route's admin check is
// the source of truth here, and the RLS policy is the backstop for the
// User-client path (e.g. a Supabase Studio user with the JWT).
//
// AC: "An admin can mark a number as re-opted-in (after fresh consent),
//      so that I can manage the opt-out registry when a customer asks to
//      be re-engaged."

interface OptOutRow {
  id: string;
  organization_id: string;
}

export const POST = withRequestContext(
  { adminOnly: true, serviceClient: true },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as
      | { note?: unknown }
      | null;
    const note =
      body && typeof body.note === "string" ? body.note.trim() : "";
    if (note.length === 0) {
      return NextResponse.json(
        { error: "note is required (record why fresh consent was given)" },
        { status: 400 },
      );
    }

    // Make sure the row belongs to the caller's active org.
    const { data: row } = await ctx.serviceClient!
      .from("phone_opt_outs")
      .select("id, organization_id")
      .eq("id", id)
      .maybeSingle<OptOutRow>();
    if (!row || row.organization_id !== ctx.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const { error } = await ctx.serviceClient!
      .from("phone_opt_outs")
      .update({
        re_opted_in_at: now,
        re_opted_in_note: note,
        re_opted_in_by_user_id: ctx.userId,
      })
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  },
);
