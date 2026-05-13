import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import type { Contract } from "@/lib/contracts/types";

// DELETE /api/contracts/[id]
//
// Slice #61 covers the `draft` branch only; voided branch lands in
// slice #63. Anything other than `draft` returns 409.
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

  if (contract.status !== "draft") {
    return NextResponse.json(
      { error: "Only draft contracts can be deleted directly. Void first." },
      { status: 409 },
    );
  }

  const { error: rpcErr } = await supabase.rpc("delete_contract", {
    p_contract_id: id,
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
