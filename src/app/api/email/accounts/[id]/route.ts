import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { encrypt } from "@/lib/encryption";

// DELETE /api/email/accounts/[id]
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("email_accounts")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

// PATCH /api/email/accounts/[id] — update account settings
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const supabase = await createServerSupabaseClient();

  // If password is being updated, encrypt it
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

  const { data, error } = await supabase
    .from("email_accounts")
    .update(updates)
    .eq("id", id)
    .select("id, label, email_address, display_name, provider, signature, imap_host, imap_port, smtp_host, smtp_port, username, is_active, is_default, color, last_synced_at, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
