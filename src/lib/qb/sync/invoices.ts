// Invoice sync primitives — mirrors customers.ts shape.
//
// Dry-run assembles the payload and returns it (caller marks the log row
// skipped_dry_run); live mode calls QB, writes qb_invoice_id back, returns
// the new QB id.
//
// sync_start_date gate: per-row short-circuit. Invoices older than the
// start date are logged as synced with a pre_sync_start_date note.
//
// Voids: if there's no qb_invoice_id the void is a no-op (the enqueue
// coalescer usually deletes the matching queued create row so this path
// is rare).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createInvoice,
  getInvoice,
  updateInvoice,
  voidInvoice as qbVoidInvoice,
} from "@/lib/qb/client";
import type { ValidToken } from "@/lib/qb/tokens";
import type {
  QbInvoiceLine,
  QbInvoicePayload,
  QbMappingRow,
  QbSyncAction,
} from "@/lib/qb/types";

export type SyncMode = "dry_run" | "live";

export interface InvoiceSyncOutcome {
  status: "synced" | "skipped_dry_run" | "deferred";
  payload: QbInvoicePayload;
  qbEntityId?: string;
  reason?: string;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  job_id: string;
  status: string;
  issued_date: string | null;
  due_date: string | null;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  po_number: string | null;
  memo: string | null;
  notes: string | null;
  qb_invoice_id: string | null;
  created_at: string;
}

interface LineItemRow {
  id: string;
  sort_order: number;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  code: string | null;
}

interface JobRow {
  id: string;
  job_number: string;
  damage_type: string;
  qb_subcustomer_id: string | null;
}

function toIsoDate(ts: string | null): string | undefined {
  if (!ts) return undefined;
  return ts.slice(0, 10);
}

export async function syncInvoice(
  supabase: SupabaseClient,
  token: ValidToken | null,
  mode: SyncMode,
  invoiceId: string,
  action: QbSyncAction,
): Promise<InvoiceSyncOutcome> {
  const { data: invoice } = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, job_id, status, issued_date, due_date, subtotal, tax_rate, tax_amount, total_amount, po_number, memo, notes, qb_invoice_id, created_at",
    )
    .eq("id", invoiceId)
    .maybeSingle<InvoiceRow>();
  if (!invoice) throw new Error(`invoices row ${invoiceId} not found`);

  // sync_start_date gate
  const connection = token?.connection;
  if (connection?.sync_start_date) {
    const startTs = Date.parse(connection.sync_start_date);
    if (Date.parse(invoice.created_at) < startTs) {
      return {
        status: "synced",
        payload: { CustomerRef: { value: "pre_sync_start_date" }, Line: [] },
        reason: "pre_sync_start_date",
      };
    }
  }

  const { data: job } = await supabase
    .from("jobs")
    .select("id, job_number, damage_type, qb_subcustomer_id")
    .eq("id", invoice.job_id)
    .maybeSingle<JobRow>();
  if (!job) throw new Error(`jobs row ${invoice.job_id} not found`);
  if (!job.qb_subcustomer_id) {
    return {
      status: "deferred",
      payload: { CustomerRef: { value: "pending" }, Line: [] },
      reason: "sub_customer_not_synced",
    };
  }

  const { data: items } = await supabase
    .from("invoice_line_items")
    .select("id, sort_order, description, quantity, unit_price, amount, code")
    .eq("invoice_id", invoice.id)
    .order("sort_order", { ascending: true });
  const lineItems = (items ?? []) as LineItemRow[];

  const { data: mappings } = await supabase
    .from("qb_mappings")
    .select("id, type, platform_value, qb_entity_id, qb_entity_name, created_at, updated_at")
    .eq("type", "damage_type");
  const classMap = (mappings ?? []) as QbMappingRow[];
  const classRef = classMap.find((m) => m.platform_value === job.damage_type) ?? null;
  if (!classRef) {
    const err = new Error(
      `Damage type "${job.damage_type}" isn't mapped to a QB Class.`,
    );
    (err as Error & { code?: string }).code = "class_not_mapped";
    throw err;
  }

  const lines: QbInvoiceLine[] = lineItems.map((li) => ({
    Amount: Number(li.amount),
    Description: li.code
      ? `[${li.code}] ${li.description}`
      : li.description,
    DetailType: "SalesItemLineDetail",
    SalesItemLineDetail: {
      Qty: Number(li.quantity),
      UnitPrice: Number(li.unit_price),
      ClassRef: { value: classRef.qb_entity_id, name: classRef.qb_entity_name },
    },
  }));

  const payload: QbInvoicePayload = {
    CustomerRef: { value: job.qb_subcustomer_id },
    Line: lines,
    ClassRef: { value: classRef.qb_entity_id, name: classRef.qb_entity_name },
    TxnDate: toIsoDate(invoice.issued_date),
    DueDate: toIsoDate(invoice.due_date),
    DocNumber: invoice.invoice_number,
    PrivateNote: `Job ${job.job_number}${invoice.memo ? ` — ${invoice.memo}` : ""}${invoice.notes ? ` — ${invoice.notes}` : ""}`.slice(0, 4000),
  };
  if (Number(invoice.tax_amount) > 0) {
    payload.TxnTaxDetail = { TotalTax: Number(invoice.tax_amount) };
  }

  if (mode === "dry_run") {
    return { status: "skipped_dry_run", payload };
  }
  if (!token) throw new Error("live sync requires a valid token");

  if (action === "update" && invoice.qb_invoice_id) {
    const current = await getInvoice(token, invoice.qb_invoice_id);
    if (!current) {
      // Vanished on QB side — recreate and repoint.
      const created = await createInvoice(token, payload);
      await supabase.from("invoices").update({ qb_invoice_id: created.id }).eq("id", invoice.id);
      return { status: "synced", payload, qbEntityId: created.id };
    }
    const updated = await updateInvoice(token, {
      ...payload,
      Id: current.Id,
      SyncToken: current.SyncToken,
    });
    return { status: "synced", payload, qbEntityId: updated.id };
  }

  if (invoice.qb_invoice_id) {
    // Already synced; nothing to create.
    return { status: "synced", payload, qbEntityId: invoice.qb_invoice_id };
  }

  const created = await createInvoice(token, payload);
  await supabase.from("invoices").update({ qb_invoice_id: created.id }).eq("id", invoice.id);
  return { status: "synced", payload, qbEntityId: created.id };
}

export async function voidInvoiceSync(
  supabase: SupabaseClient,
  token: ValidToken | null,
  mode: SyncMode,
  invoiceId: string,
): Promise<InvoiceSyncOutcome> {
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, qb_invoice_id")
    .eq("id", invoiceId)
    .maybeSingle<{ id: string; qb_invoice_id: string | null }>();
  if (!invoice) throw new Error(`invoices row ${invoiceId} not found`);

  const payload: QbInvoicePayload = {
    CustomerRef: { value: "void" },
    Line: [],
  };

  if (!invoice.qb_invoice_id) {
    return { status: "synced", payload, reason: "never_synced" };
  }

  if (mode === "dry_run") {
    return { status: "skipped_dry_run", payload, qbEntityId: invoice.qb_invoice_id };
  }
  if (!token) throw new Error("live sync requires a valid token");

  const current = await getInvoice(token, invoice.qb_invoice_id);
  if (!current) {
    return { status: "synced", payload, qbEntityId: invoice.qb_invoice_id, reason: "qb_record_gone" };
  }
  await qbVoidInvoice(token, current.Id, current.SyncToken);
  return { status: "synced", payload, qbEntityId: invoice.qb_invoice_id };
}
