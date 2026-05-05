// Build 67c2 — GET /api/invoices/[id]/send/preview
// Returns the resolved-template subject + body (HTML→text) for the send modal.
//
// Status-based blocks (draft / sent / voided) DO NOT block this route.
// The Send button in the read-only view is the UI gate; this route just
// answers "what would this email look like."

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { resolveDocumentTemplate } from "@/lib/email/template-resolver";
import { htmlToText } from "@/lib/email/html-to-text";
import { loadOrgEmailSettings } from "@/lib/email/send";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const gate = await requirePermission(supabase, "manage_invoices");
  if (!gate.ok) return gate.response;

  const orgId = await getActiveOrganizationId(supabase);
  if (!orgId) {
    return NextResponse.json({ error: "no active organization" }, { status: 400 });
  }

  const { id } = await context.params;

  // Load invoice to get job_id + verify org match
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, organization_id, job_id")
    .eq("id", id)
    .maybeSingle<{ id: string; organization_id: string; job_id: string }>();

  if (!invoice) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (invoice.organization_id !== orgId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Load settings + check from-email configured
  const settings = await loadOrgEmailSettings(supabase, orgId);
  if (!settings) {
    return NextResponse.json({ error: "settings missing" }, { status: 500 });
  }
  if (!settings.send_from_email) {
    return NextResponse.json({ from_unconfigured: true }, { status: 200 });
  }

  // Resolve template
  const resolved = await resolveDocumentTemplate(
    supabase,
    settings.invoice_send_subject_template,
    settings.invoice_send_body_template,
    invoice.job_id,
  );

  return NextResponse.json({
    from_unconfigured: false,
    subject: resolved.subject,
    body_text: htmlToText(resolved.html),
    unresolvedFields: resolved.unresolvedFields,
  });
}
