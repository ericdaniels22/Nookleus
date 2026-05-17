import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { encrypt } from "@/lib/encryption";
import { assignAccountColor } from "@/lib/email/assign-account-color";

// GET /api/email/accounts — list accounts for the active org (passwords excluded).
// Previously ungated (relied on RLS via the User client); now logged-in
// only. Recorded for the #78 ungated-endpoint list.
export const GET = withRequestContext({}, async (_request, ctx) => {
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
export const POST = withRequestContext({}, async (request, ctx) => {
  const body = await request.json();
  const { label, email_address, display_name, provider, imap_host, imap_port, smtp_host, smtp_port, username, password, color: colorOverride } = body;

  if (!email_address || !username || !password) {
    return NextResponse.json(
      { error: "email_address, username, and password are required" },
      { status: 400 }
    );
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
