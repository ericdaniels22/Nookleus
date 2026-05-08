// src/lib/conversion.ts — wraps convert_estimate_to_invoice RPC.

import type { SupabaseClient } from "@supabase/supabase-js";

export type ConversionErrorCode =
  | "estimate_not_found"
  | "estimate_not_approved"
  | "estimate_already_converted"
  | "internal";

export interface ConversionResult {
  ok: true;
  newInvoiceId: string;
  newInvoiceNumber: string;
}

export interface ConversionError {
  ok: false;
  code: ConversionErrorCode;
  existingInvoiceId?: string;        // present when code === 'estimate_already_converted'
  existingInvoiceNumber?: string;    // looked up by route handler if needed
  message?: string;
}

export type ConversionOutcome = ConversionResult | ConversionError;

export async function convertEstimateToInvoice(
  supabase: SupabaseClient,
  estimateId: string,
): Promise<ConversionOutcome> {
  const { data, error } = await supabase.rpc("convert_estimate_to_invoice", { p_estimate_id: estimateId });

  if (!error) {
    const newInvoiceId = data as string;
    const { data: inv } = await supabase
      .from("invoices").select("invoice_number").eq("id", newInvoiceId).maybeSingle<{ invoice_number: string }>();
    return { ok: true, newInvoiceId, newInvoiceNumber: inv?.invoice_number ?? "" };
  }

  // Postgres errors come back with a message string. Parse the well-known prefixes.
  const msg = error.message ?? "";
  if (msg.includes("estimate_not_found")) {
    return { ok: false, code: "estimate_not_found" };
  }
  if (msg.includes("estimate_not_approved")) {
    return { ok: false, code: "estimate_not_approved" };
  }
  if (msg.includes("estimate_already_converted:")) {
    // Format: estimate_already_converted:<uuid>
    const idMatch = msg.match(/estimate_already_converted:([0-9a-f-]+)/i);
    const existingInvoiceId = idMatch?.[1];
    let existingInvoiceNumber: string | undefined;
    if (existingInvoiceId) {
      const { data: inv } = await supabase
        .from("invoices").select("invoice_number").eq("id", existingInvoiceId).maybeSingle<{ invoice_number: string }>();
      existingInvoiceNumber = inv?.invoice_number;
    }
    return { ok: false, code: "estimate_already_converted", existingInvoiceId, existingInvoiceNumber };
  }
  return { ok: false, code: "internal", message: msg };
}
