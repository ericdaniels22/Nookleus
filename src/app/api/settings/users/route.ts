import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

const ALL_PERMISSIONS = [
  "view_jobs", "edit_jobs", "create_jobs",
  "log_activities", "upload_photos", "edit_photos",
  "view_billing", "record_payments",
  "view_email", "send_email",
  "manage_reports", "access_settings",
  "manage_contract_templates",
];

const ROLE_DEFAULTS: Record<string, string[]> = {
  admin: ALL_PERMISSIONS,
  crew_lead: [
    "view_jobs", "edit_jobs", "create_jobs",
    "log_activities", "upload_photos", "edit_photos",
    "view_billing", "record_payments",
    "view_email", "send_email", "manage_reports",
  ],
  crew_member: ["view_jobs", "log_activities", "upload_photos"],
  custom: [],
};

// GET /api/settings/users — list all members of the active org with their
// user_profiles joined. Role is sourced from user_organizations (per-org).
// The User client (ctx.supabase) lets RLS see the caller's auth.uid() so the
// user_orgs_member_read policy (build51) grants visibility into other members
// of the same org.
//
// Logged-in only — previously ungated (recorded for the #78 ungated list).
export const GET = withRequestContext(
  { serviceClient: true },
  async (_request, ctx) => {
    const { data: memberships, error } = await ctx.supabase
      .from("user_organizations")
      .select("id, user_id, role, created_at, user_profiles:user_id ( id, full_name, phone, profile_photo_path, is_active, last_login_at, created_at )")
      .eq("organization_id", ctx.orgId)
      .order("created_at");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Get auth emails via the Service client.
    try {
      const { data: authUsers } = await ctx.serviceClient!.auth.admin.listUsers();

      const enriched = (memberships || []).map((m) => {
        const profile = Array.isArray(m.user_profiles) ? m.user_profiles[0] : m.user_profiles;
        const authUser = authUsers?.users?.find((u) => u.id === m.user_id);
        return {
          ...(profile ?? {}),
          id: m.user_id,
          role: m.role,
          membership_id: m.id,
          email: authUser?.email || "",
        };
      });

      return NextResponse.json(enriched);
    } catch {
      // If the auth admin lookup fails, return memberships without emails.
      return NextResponse.json(memberships || []);
    }
  },
);

// POST /api/settings/users — invite new user. Creates the auth user (which
// fires handle_new_user to create user_profiles), then inserts the
// user_organizations row and default permissions.
//
// Logged-in only — previously ungated (recorded for the #78 ungated list).
export const POST = withRequestContext(
  { serviceClient: true },
  async (request, ctx) => {
    const { email, full_name, phone, role } = await request.json();

    if (!email || !full_name) {
      return NextResponse.json({ error: "Email and name are required" }, { status: 400 });
    }

    const service = ctx.serviceClient!;
    const orgId = ctx.orgId;
    const chosenRole = role || "crew_member";

    // Invite the new user by email — Supabase emails them an invite link they
    // use to set their own password. This also creates the auth.users row, so
    // the handle_new_user trigger still fires to create user_profiles.
    // Note: invite delivery depends on Supabase email/SMTP being configured.
    const { data: authData, error: authError } = await service.auth.admin.inviteUserByEmail(
      email,
      { data: { full_name, role: chosenRole } },
    );

    if (authError) {
      if (authError.message.includes("already been registered")) {
        return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
      }
      return NextResponse.json({ error: authError.message }, { status: 500 });
    }

    const userId = authData.user.id;

    // Fill out user_profiles with optional fields (no role column post-build48).
    await service.from("user_profiles").update({
      full_name,
      phone: phone || null,
    }).eq("id", userId);

    // Create the membership in the active org.
    const { data: membership, error: memErr } = await service
      .from("user_organizations")
      .insert({ user_id: userId, organization_id: orgId, role: chosenRole })
      .select("id")
      .single();
    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

    // Set default permissions on the new membership in user_organization_permissions.
    // Write the legacy user_permissions table too so revert during 18a is safe.
    const grantedPerms = ROLE_DEFAULTS[chosenRole] || ROLE_DEFAULTS.crew_member;
    const uopInserts = ALL_PERMISSIONS.map((perm) => ({
      user_organization_id: membership.id,
      permission_key: perm,
      granted: grantedPerms.includes(perm),
    }));
    const upInserts = ALL_PERMISSIONS.map((perm) => ({
      user_id: userId,
      permission_key: perm,
      granted: grantedPerms.includes(perm),
    }));
    await service.from("user_organization_permissions").upsert(uopInserts, {
      onConflict: "user_organization_id,permission_key",
    });
    await service.from("user_permissions").upsert(upInserts, {
      onConflict: "user_id,permission_key",
    });

    return NextResponse.json({ id: userId, email, full_name, role: chosenRole }, { status: 201 });
  },
);
