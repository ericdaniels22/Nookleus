import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/settings/users/[id]/permissions — from user_organization_permissions
// scoped to the active org's membership.
//
// Logged-in only — previously ungated (recorded for the #78 ungated list).
export const GET = withRequestContext(
  { serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const service = ctx.serviceClient!;

    const { data: membership } = await service
      .from("user_organizations")
      .select("id")
      .eq("user_id", id)
      .eq("organization_id", ctx.orgId)
      .maybeSingle<{ id: string }>();
    if (!membership) return NextResponse.json({});

    const { data, error } = await service
      .from("user_organization_permissions")
      .select("permission_key, granted")
      .eq("user_organization_id", membership.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const permsMap: Record<string, boolean> = {};
    for (const p of data || []) {
      permsMap[p.permission_key] = p.granted;
    }

    return NextResponse.json(permsMap);
  },
);

// PUT /api/settings/users/[id]/permissions — writes go to both
// user_organization_permissions (the new source of truth) and the legacy
// user_permissions table so 18a revert is safe.
//
// Logged-in only — previously ungated (recorded for the #78 ungated list).
export const PUT = withRequestContext(
  { serviceClient: true },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = await request.json() as Record<string, boolean>;
    const service = ctx.serviceClient!;

    const { data: membership } = await service
      .from("user_organizations")
      .select("id")
      .eq("user_id", id)
      .eq("organization_id", ctx.orgId)
      .maybeSingle<{ id: string }>();
    if (!membership) {
      return NextResponse.json({ error: "user is not a member of the active org" }, { status: 404 });
    }

    const uopUpserts = Object.entries(body).map(([permission_key, granted]) => ({
      user_organization_id: membership.id,
      permission_key,
      granted,
    }));
    const upUpserts = Object.entries(body).map(([permission_key, granted]) => ({
      user_id: id,
      permission_key,
      granted,
    }));

    const { error } = await service
      .from("user_organization_permissions")
      .upsert(uopUpserts, { onConflict: "user_organization_id,permission_key" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await service
      .from("user_permissions")
      .upsert(upUpserts, { onConflict: "user_id,permission_key" });

    return NextResponse.json({ success: true });
  },
);
