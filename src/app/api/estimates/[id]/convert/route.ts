import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import { convertEstimateToInvoice } from "@/lib/conversion";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";

export const POST = withRequestContext(
  { permission: "convert_estimates" },
  async (_request, { supabase }, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const { data: estimateRow } = await supabase
      .from("estimates")
      .select("deleted_at")
      .eq("id", id)
      .maybeSingle<{ deleted_at: string | null }>();
    const trashed = assertNotTrashed(estimateRow);
    if (trashed) return trashed;

    try {
      const result = await convertEstimateToInvoice(supabase, id);
      if (result.ok) {
        return NextResponse.json({
          new_invoice_id: result.newInvoiceId,
          new_invoice_number: result.newInvoiceNumber,
        });
      }
      if (result.code === "estimate_already_converted") {
        return NextResponse.json(
          {
            error: "estimate_already_converted",
            existing_invoice_id: result.existingInvoiceId,
            existing_invoice_number: result.existingInvoiceNumber,
          },
          { status: 409 },
        );
      }
      if (result.code === "estimate_not_found") {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      if (result.code === "estimate_not_approved") {
        return NextResponse.json(
          { error: "estimate_not_approved", message: "Estimate must be approved before converting." },
          { status: 400 },
        );
      }
      return apiDbError(result.message ?? "internal", "POST /api/estimates/[id]/convert");
    } catch (e: unknown) {
      return apiDbError(e instanceof Error ? e.message : String(e), "POST /api/estimates/[id]/convert");
    }
  },
);
