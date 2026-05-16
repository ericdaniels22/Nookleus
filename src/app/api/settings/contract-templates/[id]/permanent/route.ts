import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { requirePermission } from "@/lib/permissions-api";
import { apiDbError } from "@/lib/api-errors";
import {
  evaluateTemplateDeletion,
  type ReferencingContract,
} from "@/lib/contracts/template-deletion-eligibility";

// DELETE /api/settings/contract-templates/[id]/permanent
//
// Permanently removes a contract template and its uploaded PDF (issue #76).
// Distinct from DELETE /api/settings/contract-templates/[id], which is a soft
// archive (is_active=false) and still backs the "Archive" action.
//
// Gated by `manage_contract_templates` and scoped to the active organization,
// matching POST / PATCH / duplicate.
//
// The advisory eligibility check below feeds a 409 with the blocker list when
// a customer is mid-signing. The hard_delete_contract_template RPC re-checks
// the same rule inside its transaction — it is the authoritative gate against
// a contract that flips to `sent` between the dialog opening and the confirm.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authClient = await createServerSupabaseClient();
  const gate = await requirePermission(authClient, "manage_contract_templates");
  if (!gate.ok) return gate.response;
  const orgId = await getActiveOrganizationId(authClient);

  const supabase = createServiceClient();

  const { data: template, error: loadErr } = await supabase
    .from("contract_templates")
    .select("id, pdf_storage_path")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle<{ id: string; pdf_storage_path: string | null }>();
  if (loadErr) return apiDbError(loadErr.message, "DELETE template/permanent select");
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const { data: refs, error: refsErr } = await supabase
    .from("contracts")
    .select("id, status")
    .eq("template_id", id);
  if (refsErr) {
    return apiDbError(refsErr.message, "DELETE template/permanent contracts select");
  }

  const eligibility = evaluateTemplateDeletion((refs ?? []) as ReferencingContract[]);
  if (!eligibility.deletable) {
    return NextResponse.json(
      {
        error: "blocked",
        blockers: eligibility.blockers.map((b) => ({
          contractId: b.id,
          status: b.status,
        })),
      },
      { status: 409 },
    );
  }

  const { error: rpcErr } = await supabase.rpc("hard_delete_contract_template", {
    p_template_id: id,
    p_org_id: orgId,
  });
  if (rpcErr) {
    // The RPC's authoritative re-check lost a race: a contract became
    // `sent` / `viewed` after our advisory check passed.
    if (rpcErr.message.includes("template_delete_blocked")) {
      return NextResponse.json({ error: "blocked", blockers: [] }, { status: 409 });
    }
    return apiDbError(rpcErr.message, "DELETE template/permanent rpc");
  }

  // Best-effort storage cleanup. A failed storage delete must not fail the
  // request — the template row is already gone and an orphaned file is
  // harmless (per the #76 PRD).
  if (template.pdf_storage_path) {
    const { error: storageErr } = await supabase.storage
      .from("contract-pdfs")
      .remove([template.pdf_storage_path]);
    if (storageErr) {
      console.warn(
        `[template-permanent-delete] storage cleanup failed for ${template.pdf_storage_path}: ${storageErr.message}`,
      );
    }
  }

  return NextResponse.json({ success: true });
}
