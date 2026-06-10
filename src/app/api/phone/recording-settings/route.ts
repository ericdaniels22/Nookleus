import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// PRD #304 — Nookleus Phone. Slice 11 (#315) — org-level recording default.
//
// The "Record calls by default" toggle for Settings → Phone. The value lives
// on organizations.recording_enabled_default (migration-315), which the inbound
// voice webhook and the outbound bridge route read to decide whether to emit
// the consent + recording stanza.
//
// GET is view_phone (any teammate can see whether calls record by default);
// PATCH is admin-only — turning org-wide recording on/off is a Shared-scope
// admin action (ADR 0005), not something every view_phone holder may do. Both
// use the Service client scoped to the caller's Active Organization.

export const GET = withRequestContext(
  { permission: "view_phone", serviceClient: true },
  async (_request, ctx) => {
    const { data } = await ctx.serviceClient!
      .from("organizations")
      .select("recording_enabled_default")
      .eq("id", ctx.orgId)
      .maybeSingle<{ recording_enabled_default: boolean }>();
    return NextResponse.json({
      recording_enabled_default: data?.recording_enabled_default ?? false,
    });
  },
);

export const PATCH = withRequestContext(
  { adminOnly: true, serviceClient: true },
  async (request, ctx) => {
    const body = (await request.json().catch(() => null)) as {
      recording_enabled_default?: unknown;
    } | null;
    if (!body || typeof body.recording_enabled_default !== "boolean") {
      return NextResponse.json(
        { error: "recording_enabled_default (boolean) is required" },
        { status: 400 },
      );
    }

    const { error } = await ctx.serviceClient!
      .from("organizations")
      .update({ recording_enabled_default: body.recording_enabled_default })
      .eq("id", ctx.orgId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  },
);
