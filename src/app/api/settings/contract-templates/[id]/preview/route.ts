import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { requirePermission } from "@/lib/permissions-api";
import { createServiceClient } from "@/lib/supabase-api";
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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  // Permission gate: template authors (manage_contract_templates) clearly
  // need preview access, but Task 26 also wired this route up to
  // <PreviewContractModal>, which is opened from the send-contract and
  // sign-in-person modals. Users in those flows can SEND contracts but
  // may not have template-management. The send/in-person POSTs gate on
  // authenticated session + org membership only (no permission key), so
  // we match that bar as a fallback. The preview only renders sample data
  // (no contract-specific PII), so this matches the actual data sensitivity.
  const gate = await requirePermission(supabase, "manage_contract_templates");
  if (!gate.ok) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "not authenticated" }, { status: 401 });
    }
    const fallbackOrgId = await getActiveOrganizationId(supabase);
    const { data: membership } = await supabase
      .from("user_organizations")
      .select("id")
      .eq("user_id", user.id)
      .eq("organization_id", fallbackOrgId)
      .maybeSingle<{ id: string }>();
    if (!membership) return gate.response;
  }
  const orgId = await getActiveOrganizationId(supabase);

  const { data: tpl, error } = await supabase
    .from("contract_templates")
    .select("id, pdf_storage_path, pdf_pages, overlay_fields, signer_count")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) return apiDbError(error.message, "GET preview select");
  if (!tpl?.pdf_storage_path) return NextResponse.json({ error: "no_pdf" }, { status: 404 });

  // Layer the org's actual company info over the sample so the preview
  // shows real branding when present.
  const { data: orgRow } = await supabase
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

  const service = createServiceClient();
  const { data: blob, error: dlErr } = await service.storage
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
}
