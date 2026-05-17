import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import { stampPdf } from "@/lib/contracts/stamp-pdf";
import type { OverlayField, PdfPage } from "@/lib/contracts/types";

// Hardcoded sample values keyed by the actual MERGE_FIELDS names so the
// preview always renders SOMETHING for every mergeable field — useful for
// authors verifying overlay placement before any contract has been issued.
const SAMPLE_MERGE_VALUES: Record<string, string> = {
  customer_name: "John Doe",
  customer_first_name: "John",
  customer_email: "john@example.com",
  customer_phone: "(555) 123-4567",
  customer_address: "123 Main Street, Austin, TX 78701",
  property_address: "123 Main Street, Austin, TX 78701",
  property_type: "Single Family",
  job_number: "WTR-2026-SAMPLE",
  damage_type: "Water Damage",
  damage_source: "Burst pipe",
  date_today: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  intake_date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  affected_areas: "Kitchen, basement",
  insurance_company: "Sample Insurance Co",
  claim_number: "CLM-12345",
  adjuster_name: "Jane Adjuster",
  adjuster_phone: "(555) 987-6543",
  company_name: "Your Company",
  company_phone: "(555) 000-0000",
  company_email: "info@yourcompany.example",
  company_address: "100 Business Way, Austin, TX 78701",
  company_license: "TX-LIC-1234",
};

// Logged-in only. This route previously gated on `manage_contract_templates`
// but, by design, fell back to any logged-in member of the active org: it is
// opened from the send-contract and sign-in-person modals, whose own POSTs
// gate on session + org membership alone. The preview only renders sample
// data (no contract-specific PII), so the effective policy was always
// "logged-in" — that is the equivalent rule here.
export const GET = withRequestContext(
  { serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const orgId = ctx.orgId;

    const { data: tpl, error } = await ctx.supabase
      .from("contract_templates")
      .select("id, pdf_storage_path, pdf_pages, overlay_fields, signer_count")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (error) return apiDbError(error.message, "GET preview select");
    if (!tpl?.pdf_storage_path) return NextResponse.json({ error: "no_pdf" }, { status: 404 });

    // Layer the org's actual company info over the sample so the preview
    // shows real branding when present.
    const { data: orgRow } = await ctx.supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    const sample: Record<string, string> = { ...SAMPLE_MERGE_VALUES };
    if (orgRow?.name) sample.company_name = orgRow.name;

    // Sample customer inputs: each input field gets a placeholder; checkboxes ticked.
    const overlayFields = (tpl.overlay_fields ?? []) as OverlayField[];
    const customerInputs: Record<string, string | boolean> = {};
    for (const f of overlayFields) {
      if (f.type === "input" && f.inputKey) {
        customerInputs[f.inputKey] = f.inputLabel ? `Sample ${f.inputLabel}` : "Sample input";
      }
      if (f.type === "checkbox" && f.inputKey) customerInputs[f.inputKey] = true;
    }

    const { data: blob, error: dlErr } = await ctx.serviceClient!.storage
      .from("contract-pdfs")
      .download(tpl.pdf_storage_path);
    if (dlErr || !blob) return apiDbError(dlErr?.message ?? "download_failed", "GET preview download");
    const sourceBytes = new Uint8Array(await blob.arrayBuffer());

    let stampedBytes: Uint8Array;
    try {
      stampedBytes = await stampPdf({
        sourcePdfBytes: sourceBytes,
        pdfPages: (tpl.pdf_pages ?? []) as PdfPage[],
        overlayFields,
        resolvedMergeValues: sample,
        customerInputs,
        signatureDataUrls: {},
        signerOrderById: {},
        signedAt: new Date(),
      });
    } catch (err) {
      return apiDbError(String(err), "GET preview stamp");
    }

    return new NextResponse(Buffer.from(stampedBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=\"preview.pdf\"",
        "Cache-Control": "no-store",
      },
    });
  },
);
