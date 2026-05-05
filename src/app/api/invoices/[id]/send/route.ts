// Build 67c2 — POST /api/invoices/[id]/send
// Mirrors the estimate send route. Differences:
//   - Permission: manage_invoices
//   - Status check: 400 only when status === 'voided'
//   - Audit event_type: 'invoice_sent'
//   - QB sync trigger fires automatically on the draft → sent transition
//     (existing trigger; not re-fired on subsequent sends).
//
// This replaces the 67b stub that only flipped draft → sent without
// actually emailing. The companion /api/invoices/[id]/mark-sent route is
// left in place — it remains the no-email "mark as delivered" path.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { sendOrgEmail, FromUnconfiguredError } from "@/lib/email/send";
import { textToHtml } from "@/lib/email/text-to-html";
import { renderAndUploadInvoicePdf } from "@/lib/pdf-renderer/render-and-upload";
import { apiDbError } from "@/lib/api-errors";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(
  request: Request,
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

  let body: { to?: unknown; subject?: unknown; body?: unknown; preset_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const to = typeof body.to === "string" ? body.to.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const bodyText = typeof body.body === "string" ? body.body : "";
  const preset_id = typeof body.preset_id === "string" ? body.preset_id : "";

  if (!EMAIL_RE.test(to)) {
    return NextResponse.json({ error: "valid recipient email required" }, { status: 400 });
  }
  if (!subject) {
    return NextResponse.json({ error: "subject required" }, { status: 400 });
  }
  if (!bodyText) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }
  if (!preset_id) {
    return NextResponse.json({ error: "preset_id required" }, { status: 400 });
  }

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, organization_id, status, sent_at, invoice_number, job_id")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      organization_id: string;
      status: string;
      sent_at: string | null;
      invoice_number: string;
      job_id: string;
    }>();

  if (!invoice || invoice.organization_id !== orgId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (invoice.status === "voided") {
    return NextResponse.json({ error: "cannot send a voided invoice" }, { status: 400 });
  }

  const { data: preset } = await supabase
    .from("pdf_presets")
    .select("id, organization_id, document_type")
    .eq("id", preset_id)
    .maybeSingle<{ id: string; organization_id: string; document_type: string }>();

  if (
    !preset ||
    preset.organization_id !== orgId ||
    preset.document_type !== "invoice"
  ) {
    return NextResponse.json({ error: "invalid preset" }, { status: 400 });
  }

  let pdf;
  try {
    pdf = await renderAndUploadInvoicePdf({
      supabase,
      invoiceId: id,
      presetId: preset_id,
      orgId,
    });
  } catch (e) {
    return apiDbError(
      e instanceof Error ? e.message : String(e),
      "POST /api/invoices/[id]/send render",
    );
  }

  let result;
  try {
    result = await sendOrgEmail(supabase, orgId, {
      to,
      subject,
      html: textToHtml(bodyText),
      attachments: [
        {
          filename: pdf.filename,
          content: pdf.buffer,
          contentType: "application/pdf",
        },
      ],
    });
  } catch (e) {
    if (e instanceof FromUnconfiguredError) {
      return NextResponse.json(
        { error: "from_unconfigured" },
        { status: 400 },
      );
    }
    return apiDbError(
      e instanceof Error ? e.message : String(e),
      "POST /api/invoices/[id]/send dispatch",
      502,
    );
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    last_sent_at: now,
    last_sent_to_email: to,
  };
  if (invoice.status === "draft") {
    updates.status = "sent";
    updates.sent_at = now;
  }

  const { error: updateErr } = await supabase
    .from("invoices")
    .update(updates)
    .eq("id", id);

  if (updateErr) {
    return apiDbError(
      updateErr.message,
      "POST /api/invoices/[id]/send update",
    );
  }

  // Audit row — best effort; failure does not roll back the send.
  // (Same warn pattern as estimates send route per T8.1 fix-up.)
  const { error: auditErr } = await supabase.from("contract_events").insert({
    organization_id: orgId,
    contract_id: null,
    signer_id: null,
    event_type: "invoice_sent",
    metadata: {
      invoice_id: id,
      recipient: to,
      preset_id,
      message_id: result.messageId,
      provider: result.provider,
    },
  });
  if (auditErr) {
    console.warn(
      "[api] invoice_sent audit insert failed:",
      auditErr.message,
    );
  }

  return NextResponse.json({
    ok: true,
    message_id: result.messageId,
    sent_at: invoice.status === "draft" ? now : invoice.sent_at,
    last_sent_at: now,
    last_sent_to_email: to,
  });
}
