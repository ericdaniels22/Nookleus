// src/lib/invoices.ts — invoice surface (mirrors src/lib/estimates.ts)
// Replaces src/lib/invoices/types.ts (deleted in Task 11 after caller migration).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  recalculateMonetary,
  roundMoney,
  touchEntity,
  checkSnapshot,
  type SnapshotCheck,
} from "@/lib/builder-shared";
import type {
  Invoice,
  InvoiceWithContents,
  InvoiceSection,
  InvoiceLineItem,
} from "@/lib/types";

// Re-export for back-compat with old types.ts callers (they import these names).
export type {
  Invoice as InvoiceRow,
  InvoiceSection,
  InvoiceLineItem as InvoiceLineItemRow,
};

export type InvoiceStatus = Invoice["status"];

export interface InvoiceLineItemInput {
  description: string;
  quantity: number;
  unit_price: number;
}

export interface CreateInvoiceInput {
  jobId: string;
  title?: string;          // defaults to "Invoice" if omitted
  issuedDate?: string;
  dueDate?: string | null;
  // Note: 67b's create flow is "create-empty-draft + redirect-to-builder"
  // — line items are added via the builder, not the create route.
}

export { roundMoney };

// =============================================================================
// Read helpers
// =============================================================================

export async function getInvoiceWithContents(
  supabase: SupabaseClient,
  id: string,
): Promise<InvoiceWithContents | null> {
  const { data: inv } = await supabase.from("invoices").select("*").eq("id", id).maybeSingle<Invoice>();
  if (!inv) return null;

  const { data: sections } = await supabase
    .from("invoice_sections").select("*").eq("invoice_id", id).order("sort_order");
  const { data: items } = await supabase
    .from("invoice_line_items").select("*").eq("invoice_id", id).order("sort_order");

  // Build nested tree (top-level sections, with subsections nested, items grouped by section_id).
  const rawSections = (sections ?? []) as InvoiceSection[];
  const rawItems = (items ?? []) as InvoiceLineItem[];

  const itemsBySection = new Map<string, InvoiceLineItem[]>();
  for (const it of rawItems) {
    if (!it.section_id) continue;
    const arr = itemsBySection.get(it.section_id) ?? [];
    arr.push(it);
    itemsBySection.set(it.section_id, arr);
  }

  const topLevel = rawSections.filter((s) => s.parent_section_id === null);
  const subsByParent = new Map<string, InvoiceSection[]>();
  for (const s of rawSections.filter((s) => s.parent_section_id !== null)) {
    const arr = subsByParent.get(s.parent_section_id!) ?? [];
    arr.push(s);
    subsByParent.set(s.parent_section_id!, arr);
  }

  return {
    ...inv,
    sections: topLevel.map((s) => ({
      ...s,
      items: itemsBySection.get(s.id) ?? [],
      subsections: (subsByParent.get(s.id) ?? []).map((sub) => ({
        ...sub,
        items: itemsBySection.get(sub.id) ?? [],
      })),
    })),
  } as InvoiceWithContents;
}

// =============================================================================
// Mutation helpers
// =============================================================================

export interface GenerateInvoiceNumberResult {
  invoice_number: string;
  sequence_number: number;
}

export async function generateInvoiceNumber(
  supabase: SupabaseClient,
  jobId: string,
): Promise<GenerateInvoiceNumberResult> {
  const { data, error } = await supabase.rpc("generate_invoice_number", { p_job_id: jobId });
  if (error) throw error;
  // RPC returns a single-row result set
  const row = Array.isArray(data) ? data[0] : data;
  return row as GenerateInvoiceNumberResult;
}

export async function createInvoice(
  supabase: SupabaseClient,
  organizationId: string,
  input: CreateInvoiceInput,
): Promise<Invoice> {
  const { invoice_number, sequence_number } = await generateInvoiceNumber(supabase, input.jobId);

  const issued = input.issuedDate ?? new Date().toISOString().slice(0, 10);

  // Read default due-days from settings
  const { data: setting } = await supabase
    .from("company_settings").select("value")
    .eq("organization_id", organizationId).eq("key", "default_invoice_due_days").maybeSingle<{ value: string }>();
  const dueDays = setting?.value ? parseInt(setting.value, 10) || 30 : 30;
  const due = input.dueDate === undefined ? addDays(issued, dueDays) : input.dueDate;

  const { data: inv, error } = await supabase
    .from("invoices")
    .insert({
      organization_id: organizationId,
      job_id: input.jobId,
      invoice_number,
      sequence_number,
      title: input.title ?? "Invoice",
      status: "draft",
      issued_date: issued,
      due_date: due,
      tax_rate: 0,
      markup_type: "none",
      markup_value: 0,
      discount_type: "none",
      discount_value: 0,
    })
    .select().single<Invoice>();
  if (error) throw error;
  return inv;
}

export async function recalculateInvoiceTotals(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<void> {
  const { data: inv } = await supabase.from("invoices").select("markup_type,markup_value,discount_type,discount_value,tax_rate")
    .eq("id", invoiceId).maybeSingle<{
      markup_type: string;
      markup_value: number;
      discount_type: string;
      discount_value: number;
      tax_rate: number;
    }>();
  if (!inv) throw new Error("invoice_not_found");

  const { data: items } = await supabase
    .from("invoice_line_items").select("amount").eq("invoice_id", invoiceId);
  const totals = recalculateMonetary({
    lineItemTotals: (items ?? []).map((li) => Number(li.amount) || 0),
    markup_type: inv.markup_type as "percent" | "amount" | "none",
    markup_value: Number(inv.markup_value) || 0,
    discount_type: inv.discount_type as "percent" | "amount" | "none",
    discount_value: Number(inv.discount_value) || 0,
    tax_rate: Number(inv.tax_rate) || 0,
  });

  const { error } = await supabase.from("invoices").update({
    subtotal: totals.subtotal,
    markup_amount: totals.markup_amount,
    discount_amount: totals.discount_amount,
    adjusted_subtotal: totals.adjusted_subtotal,
    tax_amount: totals.tax_amount,
    total_amount: totals.total,
    updated_at: new Date().toISOString(),
  }).eq("id", invoiceId);
  if (error) throw error;
}

export async function voidInvoice(
  supabase: SupabaseClient,
  id: string,
  reason: string | null,
): Promise<void> {
  const { error } = await supabase.from("invoices").update({
    status: "voided",
    voided_at: new Date().toISOString(),
    void_reason: reason,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw error;
}

export async function checkInvoiceSnapshot(
  supabase: SupabaseClient,
  id: string,
  snapshot: string | null | undefined,
): Promise<SnapshotCheck> {
  return checkSnapshot(supabase, "invoices", id, snapshot);
}

export async function touchInvoice(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  return touchEntity(supabase, "invoices", id);
}

// =============================================================================
// Compat helpers — kept routes (mark-sent, pdf, send, void) still call these
// =============================================================================

/** computeTotals retained for kept-route compatibility. New routes use recalculateMonetary. */
export function computeTotals(
  items: InvoiceLineItemInput[],
  taxRate: number,
): { subtotal: number; taxAmount: number; total: number; lineAmounts: number[] } {
  const lineAmounts = items.map((li) => roundMoney(Number(li.quantity) * Number(li.unit_price)));
  const subtotal = roundMoney(lineAmounts.reduce((a, b) => a + b, 0));
  const taxAmount = roundMoney(subtotal * Number(taxRate || 0));
  const total = roundMoney(subtotal + taxAmount);
  return { subtotal, taxAmount, total, lineAmounts };
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
