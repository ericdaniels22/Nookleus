import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import type { Contract } from "@/lib/contracts/types";

// POST /api/contracts/[id]/restore
//
// Un-voids a contract back to the lifecycle status implied by its existing
// timestamps (signed_at → 'signed', else first_viewed_at → 'viewed', else
// sent_at → 'sent', else 'draft'). No payment-block check — restore is the
// opposite of destruction. No confirmation dialog upstream.
//
// Requires `edit_jobs` (#106) — contracts are gated on the job permissions.
// The Service client runs the restore RPC.
export const POST = withRequestContext(
  { permission: "edit_jobs", serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const supabase = ctx.serviceClient!;

    const { data: contract, error: loadErr } = await supabase
      .from("contracts")
      .select("id, job_id, status, signed_at, first_viewed_at, sent_at")
      .eq("id", id)
      .maybeSingle<
        Pick<
          Contract,
          "id" | "job_id" | "status" | "signed_at" | "first_viewed_at" | "sent_at"
        >
      >();
    if (loadErr || !contract) {
      return NextResponse.json(
        { error: loadErr?.message || "Contract not found" },
        { status: 404 },
      );
    }

    if (contract.status !== "voided") {
      return NextResponse.json(
        { error: "Only voided contracts can be restored." },
        { status: 409 },
      );
    }

    const { error: rpcErr } = await supabase.rpc("restore_contract", {
      p_contract_id: id,
      p_restored_by: ctx.userId,
    });
    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  },
);
