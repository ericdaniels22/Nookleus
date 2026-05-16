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

// GET /api/settings/contract-templates/[id]/usage
//
// Advisory endpoint for the permanent-delete UI (issue #76). Returns the
// referencing-contract picture the templates-list dialog needs to choose
// between the confirm dialog and the block dialog:
//   * `blockers`   — contracts still awaiting signature (`sent` / `viewed`);
//                    non-empty means the delete is currently blocked.
//   * `draftCount` — unsent draft contracts that would cascade-delete.
//
// Advisory only: the hard_delete_contract_template RPC remains the source of
// truth and re-checks at delete time. Gated by `manage_contract_templates`
// and scoped to the active organization, matching the permanent-delete route.
export async function GET(
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
    .select("id")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle<{ id: string }>();
  if (loadErr) return apiDbError(loadErr.message, "GET template/usage select");
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const { data: refs, error: refsErr } = await supabase
    .from("contracts")
    .select("id, status")
    .eq("template_id", id);
  if (refsErr) {
    return apiDbError(refsErr.message, "GET template/usage contracts select");
  }

  const eligibility = evaluateTemplateDeletion((refs ?? []) as ReferencingContract[]);
  return NextResponse.json({
    blockers: eligibility.blockers.map((b) => ({
      contractId: b.id,
      status: b.status,
    })),
    draftCount: eligibility.draftIds.length,
  });
}
