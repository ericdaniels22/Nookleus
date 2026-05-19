import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// PATCH /api/settings/users/[id] — update user profile. Role updates land
// on user_organizations (scoped to the active org) not user_profiles, since
// build48 dropped user_profiles.role.
//
// Gated on `access_settings` (#100) — was previously ungated logged-in-only.
export const PATCH = withRequestContext(
  { permission: "access_settings", serviceClient: true },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = await request.json();
    const service = ctx.serviceClient!;

    const profileUpdates: Record<string, unknown> = {};
    if (body.full_name !== undefined) profileUpdates.full_name = body.full_name;
    if (body.phone !== undefined) profileUpdates.phone = body.phone || null;
    if (body.is_active !== undefined) profileUpdates.is_active = body.is_active;

    if (Object.keys(profileUpdates).length > 0) {
      const { error } = await service
        .from("user_profiles")
        .update(profileUpdates)
        .eq("id", id);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (body.role !== undefined) {
      const { error } = await service
        .from("user_organizations")
        .update({ role: body.role })
        .eq("user_id", id)
        .eq("organization_id", ctx.orgId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // If deactivating, also ban the auth user
    if (body.is_active === false) {
      await service.auth.admin.updateUserById(id, { ban_duration: "876000h" }); // ~100 years
    } else if (body.is_active === true) {
      await service.auth.admin.updateUserById(id, { ban_duration: "none" });
    }

    return NextResponse.json({ success: true });
  },
);
