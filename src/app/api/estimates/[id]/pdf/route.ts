// src/app/api/estimates/[id]/pdf/route.ts — render → upload → signed URL.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { getPreset, getDefaultPreset } from "@/lib/pdf-presets";
import { renderPdf } from "@/lib/pdf-renderer/render";
import { estimatePdfPath } from "@/lib/storage/paths";
import { apiError } from "@/lib/api-errors";
import type { Estimate, EstimateSection, EstimateLineItem } from "@/lib/types";
import type { PdfCompany, PdfRecipient } from "@/lib/pdf-renderer/types";

interface CompanySettingRow { key: string; value: string | null; }

async function loadCompany(
  service: ReturnType<typeof createServiceClient>,
  orgId: string,
): Promise<PdfCompany> {
  const { data } = await service
    .from("company_settings")
    .select("key, value")
    .eq("organization_id", orgId);
  const byKey = Object.fromEntries(
    ((data ?? []) as CompanySettingRow[]).map((r) => [r.key, r.value ?? ""]),
  );
  const addressParts = [
    byKey.address_street,
    [byKey.address_city, byKey.address_state, byKey.address_zip].filter(Boolean).join(", "),
  ].filter(Boolean);
  const logoFile = byKey.logo_path || "";
  const logoUrl = logoFile
    ? service.storage.from("company-assets").getPublicUrl(logoFile).data.publicUrl
    : null;
  return {
    name: byKey.company_name || null,
    address: addressParts.length ? addressParts.join(" · ") : null,
    phone: byKey.phone || null,
    email: byKey.email || null,
    logo_url: logoUrl,
  };
}

async function loadRecipient(
  service: ReturnType<typeof createServiceClient>,
  jobId: string,
): Promise<{ recipient: PdfRecipient; jobNumber: string }> {
  const { data: job } = await service
    .from("jobs")
    .select("job_number, property_address, contacts:contact_id(first_name, last_name, email, phone)")
    .eq("id", jobId)
    .maybeSingle<{
      job_number: string | null;
      property_address: string | null;
      contacts: { first_name: string | null; last_name: string | null; email: string | null; phone: string | null } | null;
    }>();
  const contact = job?.contacts ?? null;
  const recipient: PdfRecipient = {
    name: [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || "Customer",
    email: contact?.email ?? null,
    phone: contact?.phone ?? null,
    property_address: job?.property_address ?? null,
  };
  return { recipient, jobNumber: job?.job_number ?? "JOB-UNKNOWN" };
}

interface PdfRequestBody { preset_id?: string; }

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "view_estimates");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const orgId = await getActiveOrganizationId(supabase);
  if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });

  let body: PdfRequestBody = {};
  try { body = (await request.json().catch(() => ({}))) as PdfRequestBody; }
  catch { /* empty body OK; default preset will be used */ }

  try {
    const { data: doc } = await supabase
      .from("estimates").select("*").eq("id", id).maybeSingle<Estimate>();
    if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

    const { data: sections } = await supabase
      .from("estimate_sections").select("*").eq("estimate_id", id);
    const { data: lineItems } = await supabase
      .from("estimate_line_items").select("*").eq("estimate_id", id);

    const preset = body.preset_id
      ? await getPreset(supabase, body.preset_id)
      : await getDefaultPreset(supabase, "estimate");
    if (!preset) return NextResponse.json({ error: "preset not found (and no default seeded)" }, { status: 400 });
    if (preset.document_type !== "estimate") {
      return NextResponse.json({ error: "preset document_type mismatch" }, { status: 400 });
    }

    const service = createServiceClient();
    const company = await loadCompany(service, orgId);
    const { recipient, jobNumber } = await loadRecipient(service, doc.job_id);

    const buffer = await renderPdf({
      kind: "estimate",
      document: doc,
      sections: (sections ?? []) as EstimateSection[],
      lineItems: (lineItems ?? []) as EstimateLineItem[],
      preset, company, recipient, jobNumber,
    });

    const path = estimatePdfPath(orgId, jobNumber, doc.estimate_number);
    const { error: upErr } = await service.storage
      .from("pdfs")
      .upload(path, buffer, { contentType: "application/pdf", upsert: true });
    if (upErr) return apiError(upErr, "POST /api/estimates/[id]/pdf upload");

    const { data: signed, error: signErr } = await service.storage
      .from("pdfs").createSignedUrl(path, 300);
    if (signErr || !signed) return apiError(signErr ?? new Error("sign failed"), "POST /api/estimates/[id]/pdf sign");

    return NextResponse.json({
      download_url: signed.signedUrl,
      storage_path: path,
      filename: `${doc.estimate_number}.pdf`,
    });
  } catch (e) {
    return apiError(e, "POST /api/estimates/[id]/pdf");
  }
}
