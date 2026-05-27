import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// PRD #304 — Nookleus Phone. Slice 4 (#308) — Save as Contact.
//
// Converts a raw-number Conversation (one whose `contact_id` is NULL) into
// a real Contact. The Conversation is re-pointed at the new Contact and
// the surface stops showing the "Save as Contact" button on the header.
//
// ADR 0002 carve-out: this does NOT create a Target on the Referral
// Partners list. Target creation stays a deliberate action on the
// existing Add Target dialog.
//
// Gating:
//   - view_phone permission required (the broadest phone perm).
//   - The conversation must be in the caller's active org.
//   - 409 when the conversation already has a contact_id (refuse to
//     overwrite — Save as Contact is one-shot per thread; future re-
//     pointing belongs in a different action that we have not designed).

interface ConversationRow {
  id: string;
  organization_id: string;
  outside_e164: string;
  contact_id: string | null;
}

interface ContactRow {
  id: string;
  full_name: string;
  phone: string | null;
}

export const POST = withRequestContext(
  { permission: "view_phone", serviceClient: true },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as
      | { fullName?: string }
      | null;
    const fullName = body?.fullName?.trim();
    if (!fullName) {
      return NextResponse.json(
        { error: "fullName is required" },
        { status: 400 },
      );
    }

    // Look up via the Service client. The active-org check is enforced
    // below — the Service-client read sees rows from any org, and we
    // 404 anything outside the caller's active org. Same pattern as
    // `resolveEmailAccountAccess`.
    const { data: conv } = await ctx.serviceClient!
      .from("phone_conversations")
      .select("id, organization_id, outside_e164, contact_id")
      .eq("id", id)
      .maybeSingle<ConversationRow>();

    if (!conv || conv.organization_id !== ctx.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (conv.contact_id) {
      return NextResponse.json(
        { error: "Conversation already has a contact" },
        { status: 409 },
      );
    }

    // Insert the Contact via the Service client. `contacts` has no
    // organization_id column in schema.sql; the org scoping for contacts
    // happens via the jobs join. Slice 4 follows the existing convention.
    const { data: newContact, error: insertErr } = await ctx.serviceClient!
      .from("contacts")
      .insert({ full_name: fullName, phone: conv.outside_e164 })
      .select("id, full_name, phone")
      .single<ContactRow>();
    if (insertErr || !newContact) {
      return NextResponse.json(
        { error: insertErr?.message ?? "Failed to create contact" },
        { status: 500 },
      );
    }

    // Re-point the conversation. Service client so the update is not
    // re-evaluated by RLS — the route's gate (view_phone) is the
    // authority for this action.
    const { error: updateErr } = await ctx.serviceClient!
      .from("phone_conversations")
      .update({ contact_id: newContact.id })
      .eq("id", conv.id);
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ contact: newContact });
  },
);
