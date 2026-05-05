// Build 67c2 — shared render-then-upload helper.
//
// Extracted from the byte-identical bodies of the two pdf routes
// (src/app/api/estimates/[id]/pdf/route.ts and
// src/app/api/invoices/[id]/pdf/route.ts) so the new send route can
// reuse the exact same rendering / Storage path. Helpers throw plain
// Error on failure; the caller wraps for HTTP response shape.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase-api";
import { getPreset } from "@/lib/pdf-presets";
import { renderPdf } from "@/lib/pdf-renderer/render";
import { estimatePdfPath, invoicePdfPath } from "@/lib/storage/paths";
import type {
  Estimate,
  EstimateSection,
  EstimateLineItem,
  Invoice,
  InvoiceSection,
  InvoiceLineItem,
} from "@/lib/types";
import type { PdfCompany, PdfRecipient } from "./types";

export interface PdfRenderResult {
  buffer: Buffer;
  storage_path: string;
  download_url: string;
  filename: string;
}

export interface RenderEstimatePdfArgs {
  supabase: SupabaseClient;
  estimateId: string;
  presetId: string;
  orgId: string;
}

export interface RenderInvoicePdfArgs {
  supabase: SupabaseClient;
  invoiceId: string;
  presetId: string;
  orgId: string;
}

interface CompanySettingRow {
  key: string;
  value: string | null;
}

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

export async function renderAndUploadEstimatePdf(
  args: RenderEstimatePdfArgs,
): Promise<PdfRenderResult> {
  const { supabase, estimateId, presetId, orgId } = args;

  const { data: doc } = await supabase
    .from("estimates")
    .select("*")
    .eq("id", estimateId)
    .maybeSingle<Estimate>();
  if (!doc) throw new Error("estimate not found");
  if (doc.organization_id !== orgId) throw new Error("estimate not found");

  const { data: sections } = await supabase
    .from("estimate_sections")
    .select("*")
    .eq("estimate_id", estimateId);
  const { data: lineItems } = await supabase
    .from("estimate_line_items")
    .select("*")
    .eq("estimate_id", estimateId);

  const preset = await getPreset(supabase, presetId);
  if (!preset) throw new Error("preset not found");
  if (preset.document_type !== "estimate") {
    throw new Error("preset document_type mismatch");
  }

  const service = createServiceClient();
  const company = await loadCompany(service, orgId);
  const { recipient, jobNumber } = await loadRecipient(service, doc.job_id);

  const buffer = await renderPdf({
    kind: "estimate",
    document: doc,
    sections: (sections ?? []) as EstimateSection[],
    lineItems: (lineItems ?? []) as EstimateLineItem[],
    preset,
    company,
    recipient,
    jobNumber,
  });

  const path = estimatePdfPath(orgId, jobNumber, doc.estimate_number);
  const { error: upErr } = await service.storage
    .from("pdfs")
    .upload(path, buffer, { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(`pdf upload failed: ${upErr.message}`);

  const { data: signed, error: signErr } = await service.storage
    .from("pdfs")
    .createSignedUrl(path, 300);
  if (signErr || !signed) {
    throw new Error(`pdf sign failed: ${signErr?.message ?? "unknown"}`);
  }

  return {
    buffer,
    storage_path: path,
    download_url: signed.signedUrl,
    filename: `${doc.estimate_number}.pdf`,
  };
}

export async function renderAndUploadInvoicePdf(
  args: RenderInvoicePdfArgs,
): Promise<PdfRenderResult> {
  const { supabase, invoiceId, presetId, orgId } = args;

  const { data: doc } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle<Invoice>();
  if (!doc) throw new Error("invoice not found");
  if (doc.organization_id !== orgId) throw new Error("invoice not found");

  const { data: sections } = await supabase
    .from("invoice_sections")
    .select("*")
    .eq("invoice_id", invoiceId);
  const { data: lineItems } = await supabase
    .from("invoice_line_items")
    .select("*")
    .eq("invoice_id", invoiceId);

  const preset = await getPreset(supabase, presetId);
  if (!preset) throw new Error("preset not found");
  if (preset.document_type !== "invoice") {
    throw new Error("preset document_type mismatch");
  }

  const service = createServiceClient();
  const company = await loadCompany(service, orgId);
  const { recipient, jobNumber } = await loadRecipient(service, doc.job_id);

  const buffer = await renderPdf({
    kind: "invoice",
    document: doc,
    sections: (sections ?? []) as InvoiceSection[],
    lineItems: (lineItems ?? []) as InvoiceLineItem[],
    preset,
    company,
    recipient,
    jobNumber,
  });

  const path = invoicePdfPath(orgId, jobNumber, doc.invoice_number);
  const { error: upErr } = await service.storage
    .from("pdfs")
    .upload(path, buffer, { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(`pdf upload failed: ${upErr.message}`);

  const { data: signed, error: signErr } = await service.storage
    .from("pdfs")
    .createSignedUrl(path, 300);
  if (signErr || !signed) {
    throw new Error(`pdf sign failed: ${signErr?.message ?? "unknown"}`);
  }

  return {
    buffer,
    storage_path: path,
    download_url: signed.signedUrl,
    filename: `${doc.invoice_number}.pdf`,
  };
}
