import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import {
  assertJobHasNoPayments,
  JobHasPaymentsError,
} from "@/lib/contracts/payment-block";
import { computeVoidSidecarPath } from "@/lib/contracts/pdf-void-sidecar";
import type { Contract } from "@/lib/contracts/types";

// DELETE /api/contracts/[id]
//
// Two branches:
//   * draft  — direct hard-delete, no payment-block (drafts have no audit
//     weight), no storage (drafts never produce a signed PDF).
//   * voided — payment-block guarded (voided-then-paid is possible), then
//     storage cleanup of canonical + .voided.pdf sidecar, then RPC.
// Alive statuses (sent/viewed/signed/expired) must be voided first.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authClient = await createServerSupabaseClient();
  const { data: { user }, error: authErr } = await authClient.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createServiceClient();

  const { data: contract, error: loadErr } = await supabase
    .from("contracts")
    .select("id, job_id, status, signed_pdf_path")
    .eq("id", id)
    .maybeSingle<Pick<Contract, "id" | "job_id" | "status" | "signed_pdf_path">>();
  if (loadErr || !contract) {
    return NextResponse.json(
      { error: loadErr?.message || "Contract not found" },
      { status: 404 },
    );
  }

  if (contract.status !== "draft" && contract.status !== "voided") {
    return NextResponse.json(
      {
        error:
          "Only draft or voided contracts can be deleted. Void the contract first.",
      },
      { status: 409 },
    );
  }

  if (contract.status === "voided") {
    try {
      await assertJobHasNoPayments(supabase, contract.job_id);
    } catch (e) {
      if (e instanceof JobHasPaymentsError) {
        return NextResponse.json(
          {
            error:
              "Cannot permanently delete this contract — related invoices have recorded payments. Refund or void payments first.",
          },
          { status: 409 },
        );
      }
      throw e;
    }

    if (contract.signed_pdf_path) {
      const sidecar = computeVoidSidecarPath(contract.signed_pdf_path);
      const { error: rmErr } = await supabase.storage
        .from("contracts")
        .remove([contract.signed_pdf_path, sidecar]);
      if (rmErr) {
        return NextResponse.json(
          { error: `Failed to remove signed PDF: ${rmErr.message}` },
          { status: 500 },
        );
      }
    }
  }

  const { error: rpcErr } = await supabase.rpc("delete_contract", {
    p_contract_id: id,
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
