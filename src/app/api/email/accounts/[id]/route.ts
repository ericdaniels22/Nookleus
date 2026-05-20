import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { encrypt } from "@/lib/encryption";
import { resolveEmailAccountAccess } from "@/lib/email/email-account-access-for-route";

// DELETE /api/email/accounts/[id] — disconnect an email account.
// Gated on view_email at the wrapper (the broadest email perm — anyone with
// any email perm passes); the canManage rule from the access module is the
// real gate. ADR 0001: admin manages Shared, owner manages own Personal,
// admin can disconnect (but not read) others' Personal in the same org.
export const DELETE = withRequestContext(
  { permission: "view_email", serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const resolved = await resolveEmailAccountAccess(ctx.serviceClient!, id, ctx, "canManage");
    if (resolved.kind === "response") return resolved.response;

    const { error } = await ctx.serviceClient!
      .from("email_accounts")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  },
);

// PATCH /api/email/accounts/[id] — update account settings.
// Same canManage gating as DELETE.
export const PATCH = withRequestContext(
  { permission: "view_email", serviceClient: true },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const resolved = await resolveEmailAccountAccess(ctx.serviceClient!, id, ctx, "canManage");
    if (resolved.kind === "response") return resolved.response;

    const body = await request.json();

    const updates: Record<string, unknown> = {};
    const allowedFields = ["label", "email_address", "display_name", "provider", "imap_host", "imap_port", "smtp_host", "smtp_port", "username", "is_active", "is_default", "signature", "color"];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (body.password) {
      updates.encrypted_password = encrypt(body.password);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const { data, error } = await ctx.serviceClient!
      .from("email_accounts")
      .update(updates)
      .eq("id", id)
      .select("id, label, email_address, display_name, provider, signature, imap_host, imap_port, smtp_host, smtp_port, username, is_active, is_default, color, last_synced_at, created_at, updated_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data);
  },
);
