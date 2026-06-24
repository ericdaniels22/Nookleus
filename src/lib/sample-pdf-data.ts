// src/lib/sample-pdf-data.ts — synthetic data for the preset preview route.

import type {
  PdfPreset, Estimate, EstimateSection, EstimateLineItem,
  Invoice, InvoiceSection, InvoiceLineItem,
} from "@/lib/types";
import type { PdfCompany, PdfRecipient } from "@/lib/pdf-renderer/types";
import { resolveEffectiveLayout } from "@/lib/pdf-layout";

export const SAMPLE_COMPANY: PdfCompany = {
  name: "Sample Company LLC",
  address: "123 Main Street · Houston, TX 77001",
  phone: "(555) 555-5555",
  email: "hello@example.com",
  logo_url: null,
};

export const SAMPLE_RECIPIENT: PdfRecipient = {
  name: "Jane Smith",
  email: "jane@example.com",
  phone: "(555) 123-4567",
  property_address: "456 Oak Avenue, Houston, TX 77002",
};

export const SAMPLE_JOB_NUMBER = "JOB-2026-0001";

export function buildSampleEstimate(orgId: string): {
  document: Estimate;
  sections: EstimateSection[];
  lineItems: EstimateLineItem[];
} {
  const estId = "00000000-0000-0000-0000-000000000001";
  const secId = "00000000-0000-0000-0000-000000000002";
  const now = new Date().toISOString();
  const document: Estimate = {
    id: estId,
    organization_id: orgId,
    job_id: "00000000-0000-0000-0000-0000000000aa",
    estimate_number: "JOB-2026-0001-EST-1",
    sequence_number: 1,
    title: "Sample Estimate",
    status: "draft",
    opening_statement: "<p>Thank you for choosing us for your emergency service needs.</p>",
    closing_statement: "<p>Payment due within 30 days. Please contact us with any questions.</p>",
    subtotal: 1200,
    markup_type: "percent",
    markup_value: 15,
    markup_amount: 180,
    // #572 — Markup split into Overhead + Profit. Both legs are non-zero
    // (10% + 5% of 1200) so a preset preview with the #576 toggles on shows
    // both rows; together they still equal markup_amount, so the combined
    // figure and every downstream total below are unchanged.
    overhead_type: "percent",
    overhead_value: 10,
    overhead_amount: 120,
    profit_type: "percent",
    profit_value: 5,
    profit_amount: 60,
    discount_type: "amount",
    discount_value: 50,
    discount_amount: 50,
    adjusted_subtotal: 1330,
    tax_rate: 8.25,
    tax_amount: 109.73,
    total: 1439.73,
    issued_date: now.slice(0, 10),
    valid_until: null,
    converted_to_invoice_id: null,
    converted_at: null,
    sent_at: null,
    approved_at: null,
    rejected_at: null,
    voided_at: null,
    void_reason: null,
    created_by: null,
    created_at: now,
    updated_at: now,
    last_sent_at: null,
    last_sent_to_email: null,
    deleted_at: null,
    delete_reason: null,
    pdf_layout: null,
  };
  const sections: EstimateSection[] = [{
    id: secId,
    organization_id: orgId,
    estimate_id: estId,
    parent_section_id: null,
    title: "Initial Response",
    sort_order: 0,
    created_at: now,
    updated_at: now,
  }];
  const lineItems: EstimateLineItem[] = [
    {
      id: "00000000-0000-0000-0000-000000000010",
      organization_id: orgId,
      estimate_id: estId,
      section_id: secId,
      library_item_id: null,
      name: null,
      description: "Emergency response — first hour",
      code: "ER-1",
      quantity: 1,
      unit: "hr",
      unit_price: 250,
      total: 250,
      note: "Includes after-hours dispatch surcharge",
      pricing_mode: "standard",
      pieces: null,
      days: null,
      sort_order: 0,
      created_at: now,
      updated_at: now,
    },
    {
      id: "00000000-0000-0000-0000-000000000011",
      organization_id: orgId,
      estimate_id: estId,
      section_id: secId,
      library_item_id: null,
      name: null,
      description: "Air mover — daily rental",
      code: "AM-D",
      quantity: 5,
      unit: "day",
      unit_price: 190,
      total: 950,
      note: null,
      pricing_mode: "standard",
      pieces: null,
      days: null,
      sort_order: 1,
      created_at: now,
      updated_at: now,
    },
  ];
  return { document, sections, lineItems };
}

export function buildSampleInvoice(orgId: string): {
  document: Invoice;
  sections: InvoiceSection[];
  lineItems: InvoiceLineItem[];
} {
  const invId = "00000000-0000-0000-0000-000000000020";
  const secId = "00000000-0000-0000-0000-000000000021";
  const now = new Date().toISOString();
  const document: Invoice = {
    id: invId,
    organization_id: orgId,
    job_id: "00000000-0000-0000-0000-0000000000aa",
    invoice_number: "JOB-2026-0001-INV-1",
    sequence_number: 1,
    title: "Sample Invoice",
    status: "draft",
    issued_date: now.slice(0, 10),
    due_date: null,
    opening_statement: "<p>Thank you for choosing us for your emergency service needs.</p>",
    closing_statement: "<p>Payment due within 30 days. Please contact us with any questions.</p>",
    subtotal: 1200,
    markup_type: "percent",
    markup_value: 15,
    markup_amount: 180,
    // #575 — invoices carry the Overhead + Profit split too. Like the sample
    // estimate above, both legs are non-zero (10% + 5% of 1200) so an invoice
    // preset preview with the #576 toggles on shows both rows; together they
    // still equal markup_amount, so the downstream totals are unchanged.
    overhead_type: "percent",
    overhead_value: 10,
    overhead_amount: 120,
    profit_type: "percent",
    profit_value: 5,
    profit_amount: 60,
    discount_type: "amount",
    discount_value: 50,
    discount_amount: 50,
    adjusted_subtotal: 1330,
    tax_rate: 8.25,
    tax_amount: 109.73,
    total_amount: 1439.73,
    po_number: null,
    memo: null,
    notes: null,
    converted_from_estimate_id: null,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    qb_invoice_id: null,
    created_by: null,
    created_at: now,
    updated_at: now,
    last_sent_at: null,
    last_sent_to_email: null,
    deleted_at: null,
    delete_reason: null,
    pdf_layout: null,
  };
  const sections: InvoiceSection[] = [{
    id: secId,
    organization_id: orgId,
    invoice_id: invId,
    parent_section_id: null,
    title: "Initial Response",
    sort_order: 0,
    created_at: now,
    updated_at: now,
  }];
  const lineItems: InvoiceLineItem[] = [
    {
      id: "00000000-0000-0000-0000-000000000030",
      organization_id: orgId,
      invoice_id: invId,
      section_id: secId,
      library_item_id: null,
      name: null,
      description: "Emergency response — first hour",
      code: "ER-1",
      quantity: 1,
      unit: "hr",
      unit_price: 250,
      amount: 250,
      note: "Includes after-hours dispatch surcharge",
      sort_order: 0,
      created_at: now,
      updated_at: now,
    },
    {
      id: "00000000-0000-0000-0000-000000000031",
      organization_id: orgId,
      invoice_id: invId,
      section_id: secId,
      library_item_id: null,
      name: null,
      description: "Air mover — daily rental",
      code: "AM-D",
      quantity: 5,
      unit: "day",
      unit_price: 190,
      amount: 950,
      note: null,
      sort_order: 1,
      created_at: now,
      updated_at: now,
    },
  ];
  return { document, sections, lineItems };
}

export function buildSampleInput(preset: PdfPreset, orgId: string) {
  // The preset preview shows the preset's own look: resolve it as the effective
  // layout with no per-document override (preset → field defaults).
  const layout = resolveEffectiveLayout(null, preset);
  if (preset.document_type === "estimate") {
    const sample = buildSampleEstimate(orgId);
    return {
      kind: "estimate" as const,
      ...sample,
      layout,
      company: SAMPLE_COMPANY,
      recipient: SAMPLE_RECIPIENT,
      jobNumber: SAMPLE_JOB_NUMBER,
    };
  }
  const sample = buildSampleInvoice(orgId);
  return {
    kind: "invoice" as const,
    ...sample,
    layout,
    company: SAMPLE_COMPANY,
    recipient: SAMPLE_RECIPIENT,
    jobNumber: SAMPLE_JOB_NUMBER,
  };
}
