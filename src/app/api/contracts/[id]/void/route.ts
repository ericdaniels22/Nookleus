import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import {
  writeVoidWatermarkSidecar,
  CanonicalPdfNotFoundError,
} from "@/lib/contracts/pdf-void-sidecar";
import {
  assertJobHasNoPayments,
  JobHasPaymentsError,
} from "@/lib/contracts/payment-block";
import type { Contract } from "@/lib/contracts/types";

// POST /api/contracts/[id]/void
// Body: { reason?: string }
//
// Lifecycle:
//   * Blocks voids when any invoice on the same job has a recorded payment
//     (shared with permanent-delete via assertJobHasNoPayments).
//   * For contracts that are already 'signed', writes the "VOIDED"
//     watermark to a sidecar storage key (canonical.pdf.voided.pdf),
//     leaving the canonical signed PDF untouched. This is what makes
//     restore-after-void of a signed contract recoverable — the canonical
//     key is always the clean original.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authClient = await createServerSupabaseClient();
  const { data: { user }, error: authErr } = await authClient.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { reason?: string };
  const reason = (body.reason || "").toString().slice(0, 500) || null;

  const supabase = createServiceClient();

  const { data: contract, error: loadErr } = await supabase
    .from("contracts")
    .select("id, job_id, status, signed_pdf_path")
    .eq("id", id)
    .maybeSingle<Pick<Contract, "id" | "job_id" | "status" | "signed_pdf_path">>();
  if (loadErr || !contract) {
    return NextResponse.json({ error: loadErr?.message || "Contract not found" }, { status: 404 });
  }
  if (contract.status === "voided") {
    return NextResponse.json({ error: "Already voided" }, { status: 409 });
  }

  try {
    await assertJobHasNoPayments(supabase, contract.job_id);
  } catch (e) {
    if (e instanceof JobHasPaymentsError) {
      return NextResponse.json(
        {
          error:
            "Cannot void this contract — related invoices have recorded payments. Refund or void payments first.",
        },
        { status: 409 },
      );
    }
    throw e;
  }

  if (contract.status === "signed" && contract.signed_pdf_path) {
    try {
      await writeVoidWatermarkSidecar(supabase, contract.signed_pdf_path);
    } catch (e) {
      if (e instanceof CanonicalPdfNotFoundError) {
        // Orphan row: contract.signed_pdf_path is set but the file is gone
        // (or was never uploaded — seed/test rows do this). Soft-skip the
        // sidecar; the status flip below is what kills the signing link.
        console.warn(
          `[void] canonical PDF missing for contract ${id} at ${contract.signed_pdf_path}; voiding without sidecar`,
        );
      } else {
        return NextResponse.json(
          {
            error: `Failed to watermark signed PDF: ${e instanceof Error ? e.message : String(e)}`,
          },
          { status: 500 },
        );
      }
    }
  }

  const { error } = await supabase.rpc("void_contract", {
    p_contract_id: id,
    p_voided_by: user.id,
    p_reason: reason,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
