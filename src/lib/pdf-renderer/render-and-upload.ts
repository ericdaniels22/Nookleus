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

/**
 * Thrown by render helpers when caller-supplied input is invalid (doc not
 * found, cross-org doc, preset not found, preset type mismatch). Pdf routes
 * catch this and return 4xx; send routes pre-validate so this should never
 * fire for them, but they wrap any escape via apiDbError → 500.
 */
export class PdfRenderInputError extends Error {
  readonly status: 404 | 400;
  constructor(message: string, status: 404 | 400) {
    super(message);
    this.name = "PdfRenderInputError";
    this.status = status;
  }
}

export interface PdfRenderResult {
  buffer: Buffer;
  storage_path: string;
  download_url: string;
  filename: string;
}

/**
 * Output of the render-only helpers: the PDF bytes plus the identifiers the
 * upload path needs to build its Storage key and download filename.
 * `documentNumber` is the estimate_number / invoice_number.
 */
export interface RenderedPdf {
  buffer: Buffer;
  documentNumber: string;
  jobNumber: string;
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
    .select("job_number, property_address, contacts:contact_id(full_name, email, phone)")
    .eq("id", jobId)
    .maybeSingle<{
      job_number: string | null;
      property_address: string | null;
      contacts: { full_name: string | null; email: string | null; phone: string | null } | null;
    }>();
  const contact = job?.contacts ?? null;
  const recipient: PdfRecipient = {
    name: contact?.full_name?.trim() || "Customer",
    email: contact?.email ?? null,
    phone: contact?.phone ?? null,
    property_address: job?.property_address ?? null,
  };
  return { recipient, jobNumber: job?.job_number ?? "JOB-UNKNOWN" };
}

/**
 * Render-only core: load the estimate + its contents, resolve the preset,
 * and produce the PDF buffer — WITHOUT touching Storage. The inline-preview
 * route (#385) uses this directly so a View stays a pure read; the
 * upload variant below layers Storage persistence on top. Returns the
 * document/job numbers the upload path needs for its Storage key + filename.
 */
export async function renderEstimatePdfBuffer(
  args: RenderEstimatePdfArgs,
): Promise<RenderedPdf> {
  const { supabase, estimateId, presetId, orgId } = args;

  const { data: doc } = await supabase
    .from("estimates")
    .select("*")
    .eq("id", estimateId)
    .maybeSingle<Estimate>();
  if (!doc) throw new PdfRenderInputError("estimate not found", 404);
  if (doc.organization_id !== orgId) throw new PdfRenderInputError("estimate not found", 404);

  const { data: sections } = await supabase
    .from("estimate_sections")
    .select("*")
    .eq("estimate_id", estimateId);
  const { data: lineItems } = await supabase
    .from("estimate_line_items")
    .select("*")
    .eq("estimate_id", estimateId);

  const preset = await getPreset(supabase, presetId);
  if (!preset) throw new PdfRenderInputError("preset not found", 400);
  if (preset.document_type !== "estimate") {
    throw new PdfRenderInputError("preset document_type mismatch", 400);
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

  return { buffer, documentNumber: doc.estimate_number, jobNumber };
}

export async function renderAndUploadEstimatePdf(
  args: RenderEstimatePdfArgs,
): Promise<PdfRenderResult> {
  const { orgId } = args;
  const { buffer, documentNumber, jobNumber } = await renderEstimatePdfBuffer(args);

  const service = createServiceClient();
  const path = estimatePdfPath(orgId, jobNumber, documentNumber);
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
    filename: `${documentNumber}.pdf`,
  };
}

/**
 * Render-only core for invoices — the invoice twin of
 * renderEstimatePdfBuffer. Loads the invoice + contents, resolves the preset,
 * and produces the PDF buffer without touching Storage, for the inline
 * preview route (#385).
 */
export async function renderInvoicePdfBuffer(
  args: RenderInvoicePdfArgs,
): Promise<RenderedPdf> {
  const { supabase, invoiceId, presetId, orgId } = args;

  const { data: doc } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle<Invoice>();
  if (!doc) throw new PdfRenderInputError("invoice not found", 404);
  if (doc.organization_id !== orgId) throw new PdfRenderInputError("invoice not found", 404);

  const { data: sections } = await supabase
    .from("invoice_sections")
    .select("*")
    .eq("invoice_id", invoiceId);
  const { data: lineItems } = await supabase
    .from("invoice_line_items")
    .select("*")
    .eq("invoice_id", invoiceId);

  const preset = await getPreset(supabase, presetId);
  if (!preset) throw new PdfRenderInputError("preset not found", 400);
  if (preset.document_type !== "invoice") {
    throw new PdfRenderInputError("preset document_type mismatch", 400);
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

  return { buffer, documentNumber: doc.invoice_number, jobNumber };
}

export async function renderAndUploadInvoicePdf(
  args: RenderInvoicePdfArgs,
): Promise<PdfRenderResult> {
  const { orgId } = args;
  const { buffer, documentNumber, jobNumber } = await renderInvoicePdfBuffer(args);

  const service = createServiceClient();
  const path = invoicePdfPath(orgId, jobNumber, documentNumber);
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
    filename: `${documentNumber}.pdf`,
  };
}
