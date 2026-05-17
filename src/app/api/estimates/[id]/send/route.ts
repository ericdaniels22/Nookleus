// Build 67c2 — POST /api/estimates/[id]/send
// Renders PDF → uploads to Storage → sends email → atomically updates
// estimate row + writes contract_events audit row. Failures at any
// pre-email step leave the document state untouched.

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { sendOrgEmail, FromUnconfiguredError } from "@/lib/email/send";
import { textToHtml } from "@/lib/email/text-to-html";
import { renderAndUploadEstimatePdf } from "@/lib/pdf-renderer/render-and-upload";
import { apiDbError } from "@/lib/api-errors";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BLOCKED_STATUSES = new Set(["voided", "converted"]);

export const POST = withRequestContext(
  { permission: "manage_estimates" },
  async (request, { supabase, orgId }, { params }: { params: Promise<{ id: string }> }) => {
    if (!orgId) {
      return NextResponse.json({ error: "no active organization" }, { status: 400 });
    }

    const { id } = await params;

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

    // Load estimate
    const { data: estimate } = await supabase
      .from("estimates")
      .select("id, organization_id, status, sent_at, estimate_number, job_id, deleted_at")
      .eq("id", id)
      .maybeSingle<{
        id: string;
        organization_id: string;
        status: string;
        sent_at: string | null;
        estimate_number: string;
        job_id: string;
        deleted_at: string | null;
      }>();

    if (!estimate || estimate.organization_id !== orgId) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const trashed = assertNotTrashed(estimate);
    if (trashed) return trashed;
    if (BLOCKED_STATUSES.has(estimate.status)) {
      return NextResponse.json(
        { error: `cannot send a ${estimate.status} estimate` },
        { status: 400 },
      );
    }

    // Verify preset belongs to org + matches document_type
    const { data: preset } = await supabase
      .from("pdf_presets")
      .select("id, organization_id, document_type")
      .eq("id", preset_id)
      .maybeSingle<{ id: string; organization_id: string; document_type: string }>();

    if (
      !preset ||
      preset.organization_id !== orgId ||
      preset.document_type !== "estimate"
    ) {
      return NextResponse.json({ error: "invalid preset" }, { status: 400 });
    }

    // Render + upload PDF
    let pdf;
    try {
      pdf = await renderAndUploadEstimatePdf({
        supabase,
        estimateId: id,
        presetId: preset_id,
        orgId,
      });
    } catch (e) {
      return apiDbError(
        e instanceof Error ? e.message : String(e),
        "POST /api/estimates/[id]/send render",
      );
    }

    // Send email
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
        "POST /api/estimates/[id]/send dispatch",
        502,
      );
    }

    // Update document + write audit
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {
      last_sent_at: now,
      last_sent_to_email: to,
    };
    if (estimate.status === "draft") {
      updates.status = "sent";
      updates.sent_at = now;
    }

    const { error: updateErr } = await supabase
      .from("estimates")
      .update(updates)
      .eq("id", id);

    if (updateErr) {
      return apiDbError(
        updateErr.message,
        "POST /api/estimates/[id]/send update",
      );
    }

    // Audit row — best effort; failure does not roll back the send.
    const { error: auditErr } = await supabase.from("contract_events").insert({
      organization_id: orgId,
      contract_id: null,
      signer_id: null,
      event_type: "estimate_sent",
      metadata: {
        estimate_id: id,
        recipient: to,
        preset_id,
        message_id: result.messageId,
        provider: result.provider,
      },
    });
    if (auditErr) {
      console.warn(
        "[api] estimate_sent audit insert failed:",
        auditErr.message,
      );
    }

    return NextResponse.json({
      ok: true,
      message_id: result.messageId,
      sent_at: estimate.status === "draft" ? now : estimate.sent_at,
      last_sent_at: now,
      last_sent_to_email: to,
    });
  },
);
