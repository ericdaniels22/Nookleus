import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { encrypt } from "@/lib/encryption";
import { assignAccountColor } from "@/lib/email/assign-account-color";

// GET /api/email/accounts — list accounts for the active org (passwords excluded).
// Requires `view_email` (#105, PRD #95) — tightened from the logged-in-only
// gate the #85 Request-Context conversion gave this previously-ungated route.
export const GET = withRequestContext({ permission: "view_email" }, async (_request, ctx) => {
  const { data, error } = await ctx.supabase
    .from("email_accounts")
    .select("id, label, email_address, display_name, provider, signature, imap_host, imap_port, smtp_host, smtp_port, username, is_active, is_default, color, last_synced_at, last_synced_uid, created_at, updated_at")
    .eq("organization_id", ctx.orgId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
});

// POST /api/email/accounts — add a new email account for the active org.
// Requires `send_email` (#105, PRD #95) — account management is a write, like
// account update / disconnect / test.
export const POST = withRequestContext({ permission: "send_email" }, async (request, ctx) => {
  const body = await request.json();
  const { label, email_address, display_name, provider, imap_host, imap_port, smtp_host, smtp_port, username, password, color: colorOverride, user_id } = body;

  if (!email_address || !username || !password) {
    return NextResponse.json(
      { error: "email_address, username, and password are required" },
      { status: 400 }
    );
  }

  // ADR 0001 ownership rule. Admin may set any owner (or null for Shared);
  // non-admin may only own the account themselves — any other `user_id`,
  // including null, is denied.
  if (ctx.role !== "admin" && user_id !== ctx.userId) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const encrypted_password = encrypt(password);

  const orgId = ctx.orgId;

  // Auto-assign the next palette color for this org (caller may override).
  const { data: existing } = await ctx.supabase
    .from("email_accounts")
    .select("color")
    .eq("organization_id", orgId);
  const existingColors = (existing ?? [])
    .map((r: { color: string | null }) => r.color)
    .filter((c): c is string => typeof c === "string");
  const color = assignAccountColor(orgId, existingColors, colorOverride);

  const { data, error } = await ctx.supabase
    .from("email_accounts")
    .insert({
      organization_id: orgId,
      // null marks Shared (org-wide); a uuid marks Personal owned by that
      // user. The ownership rule above guarantees a non-admin's value here
      // is their own id; an admin's value is whatever they sent.
      user_id: user_id ?? null,
      label: label || email_address,
      email_address,
      display_name: display_name || "AAA Disaster Recovery",
      provider: provider || "custom",
      imap_host: imap_host || "imap.hostinger.com",
      imap_port: imap_port || 993,
      smtp_host: smtp_host || "smtp.hostinger.com",
      smtp_port: smtp_port || 465,
      username,
      encrypted_password,
      color,
    })
    .select("id, label, email_address, display_name, provider, signature, imap_host, imap_port, smtp_host, smtp_port, username, is_active, is_default, color, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
});
