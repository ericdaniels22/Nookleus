import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { encrypt } from "@/lib/encryption";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { assignAccountColor } from "@/lib/email/assign-account-color";

// GET /api/email/accounts — list accounts for the active org (passwords excluded)
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("email_accounts")
    .select("id, label, email_address, display_name, provider, signature, imap_host, imap_port, smtp_host, smtp_port, username, is_active, is_default, color, last_synced_at, last_synced_uid, created_at, updated_at")
    .eq("organization_id", await getActiveOrganizationId(supabase))
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

// POST /api/email/accounts — add a new email account for the active org.
export async function POST(request: Request) {
  const body = await request.json();
  const { label, email_address, display_name, provider, imap_host, imap_port, smtp_host, smtp_port, username, password, color: colorOverride } = body;

  if (!email_address || !username || !password) {
    return NextResponse.json(
      { error: "email_address, username, and password are required" },
      { status: 400 }
    );
  }

  const encrypted_password = encrypt(password);

  const supabase = await createServerSupabaseClient();
  const orgId = await getActiveOrganizationId(supabase);

  // Auto-assign the next palette color for this org (caller may override).
  const { data: existing } = await supabase
    .from("email_accounts")
    .select("color")
    .eq("organization_id", orgId);
  const existingColors = (existing ?? [])
    .map((r: { color: string | null }) => r.color)
    .filter((c): c is string => typeof c === "string");
  const color = assignAccountColor(orgId, existingColors, colorOverride);

  const { data, error } = await supabase
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
}
