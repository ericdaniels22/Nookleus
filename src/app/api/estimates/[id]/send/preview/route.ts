// Build 67c2 — GET /api/estimates/[id]/send/preview
// Returns the resolved-template subject + body (HTML→text) for the send modal.
//
// Status-based blocks (voided / converted / rejected) do NOT block this route.
// The Send button in the read-only view is the UI gate; this route just
// answers "what would this email look like."

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { resolveDocumentTemplate } from "@/lib/email/template-resolver";
import { htmlToText } from "@/lib/email/html-to-text";
import { loadOrgEmailSettings } from "@/lib/email/send";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";

export const GET = withRequestContext(
  { permission: "manage_estimates" },
  async (_request, { supabase, orgId }, { params }: { params: Promise<{ id: string }> }) => {
    if (!orgId) {
      return NextResponse.json({ error: "no active organization" }, { status: 400 });
    }

    const { id } = await params;

    // Load estimate to get job_id + verify org match
    const { data: estimate } = await supabase
      .from("estimates")
      .select("id, organization_id, job_id, deleted_at")
      .eq("id", id)
      .maybeSingle<{ id: string; organization_id: string; job_id: string; deleted_at: string | null }>();

    if (!estimate) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (estimate.organization_id !== orgId) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const trashed = assertNotTrashed(estimate);
    if (trashed) return trashed;

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
      settings.estimate_send_subject_template,
      settings.estimate_send_body_template,
      estimate.job_id,
    );

    return NextResponse.json({
      from_unconfigured: false,
      subject: resolved.subject,
      body_text: htmlToText(resolved.html),
      unresolvedFields: resolved.unresolvedFields,
    });
  },
);
