import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { requirePermission } from "@/lib/permissions-api";
import { createServiceClient } from "@/lib/supabase-api";
import { apiDbError } from "@/lib/api-errors";

// POST /api/settings/contract-templates/[id]/duplicate
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const gate = await requirePermission(supabase, "manage_contract_templates");
  if (!gate.ok) return gate.response;
  const orgId = await getActiveOrganizationId(supabase);

  const { data: source, error: fetchErr } = await supabase
    .from("contract_templates")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (fetchErr) return apiDbError(fetchErr.message, "POST duplicate select");
  if (!source) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  // Insert the copy with overlay_fields preserved but pdf_storage_path
  // initially null — copied below post-insert so the path can include the
  // new row's id.
  const { data: inserted, error: insertErr } = await supabase
    .from("contract_templates")
    .insert({
      organization_id: orgId,
      name: `${source.name} (Copy)`,
      description: source.description,
      pdf_storage_path: null,
      pdf_page_count: source.pdf_page_count,
      pdf_pages: source.pdf_pages,
      overlay_fields: source.overlay_fields,
      signer_count: source.signer_count,
      signer_role_label: source.signer_role_label,
      is_active: false,
      version: 1,
      created_by: gate.userId,
    })
    .select()
    .single();
  if (insertErr) return apiDbError(insertErr.message, "POST duplicate insert");

  // Copy the source PDF in Storage if present, then patch pdf_storage_path.
  if (source.pdf_storage_path) {
    const newPath = `${orgId}/templates/${inserted.id}.pdf`;
    const service = createServiceClient();
    const { error: copyErr } = await service.storage
      .from("contract-pdfs")
      .copy(source.pdf_storage_path, newPath);
    if (!copyErr) {
      await supabase
        .from("contract_templates")
        .update({ pdf_storage_path: newPath })
        .eq("id", inserted.id);
      inserted.pdf_storage_path = newPath;
    }
    // If copy fails (e.g. source PDF missing), keep the row but with
    // pdf_storage_path=null. The user will need to re-upload.
  }

  return NextResponse.json(inserted, { status: 201 });
}
