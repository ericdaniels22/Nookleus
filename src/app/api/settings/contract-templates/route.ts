import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { requirePermission } from "@/lib/permissions-api";
import { apiDbError } from "@/lib/api-errors";

// GET /api/settings/contract-templates — list templates for the active org.
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("contract_templates")
    .select(
      "id, name, description, pdf_page_count, signer_count, is_active, updated_at",
    )
    .eq("organization_id", await getActiveOrganizationId(supabase))
    .order("updated_at", { ascending: false });

  if (error) return apiDbError(error.message, "GET /api/settings/contract-templates");
  return NextResponse.json(data ?? []);
}

// POST /api/settings/contract-templates — create a new blank template scoped to the active org.
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const gate = await requirePermission(supabase, "manage_contract_templates");
  if (!gate.ok) return gate.response;
  const userId = gate.userId;

  const body = await request.json().catch(() => ({}));
  const name: string = (body?.name || "Untitled Template").toString().slice(0, 120);
  const orgId = await getActiveOrganizationId(supabase);

  const { data, error } = await supabase
    .from("contract_templates")
    .insert({
      organization_id: orgId,
      name,
      description: body?.description ?? null,
      pdf_storage_path: null,
      pdf_page_count: null,
      pdf_pages: null,
      overlay_fields: [],
      signer_count: body.signer_count === 2 ? 2 : 1,
      signer_role_label: body.signer_role_label ?? "Customer",
      is_active: false,
      version: 1,
      created_by: userId,
    })
    .select()
    .single();

  if (error) return apiDbError(error.message, "POST /api/settings/contract-templates insert");
  return NextResponse.json(data, { status: 201 });
}
