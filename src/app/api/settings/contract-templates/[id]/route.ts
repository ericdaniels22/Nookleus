import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { requirePermission } from "@/lib/permissions-api";
import { apiDbError } from "@/lib/api-errors";
import type { OverlayField, PdfPage } from "@/lib/contracts/types";
import { validateOverlayFields } from "@/lib/contracts/overlay-validation";

// GET /api/settings/contract-templates/[id]
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("contract_templates")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  return NextResponse.json(data);
}

// PATCH /api/settings/contract-templates/[id] — auto-save handler.
// 409 stale-check via the version column (mirrors 67a auto-save).
// overlay_fields validated server-side.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const gate = await requirePermission(supabase, "manage_contract_templates");
  if (!gate.ok) return gate.response;
  const orgId = await getActiveOrganizationId(supabase);

  const body = await request.json().catch(() => ({}));

  // Fetch existing for stale-check + validation context.
  const { data: existing, error: fetchErr } = await supabase
    .from("contract_templates")
    .select("id, version, pdf_pages, signer_count")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (fetchErr) return apiDbError(fetchErr.message, "PATCH template/[id] select");
  if (!existing) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  // 409 stale-check.
  const incomingVersion = Number(body.version);
  if (Number.isFinite(incomingVersion) && incomingVersion !== existing.version) {
    return NextResponse.json({ error: "stale", current: existing.version }, { status: 409 });
  }

  const update: Partial<{
    name: string;
    description: string | null;
    signer_count: 1 | 2;
    signer_role_label: string;
    overlay_fields: OverlayField[];
    is_active: boolean;
    version: number;
  }> = {};

  if (typeof body.name === "string") update.name = body.name.trim().slice(0, 120);
  if (body.description === null || typeof body.description === "string") {
    update.description = body.description;
  }
  if (body.signer_count === 1 || body.signer_count === 2) {
    update.signer_count = body.signer_count;
  }
  if (typeof body.signer_role_label === "string") {
    update.signer_role_label = body.signer_role_label.slice(0, 120);
  }
  if (Array.isArray(body.overlay_fields)) {
    const errs = validateOverlayFields(
      body.overlay_fields as OverlayField[],
      (existing.pdf_pages ?? null) as PdfPage[] | null,
      (update.signer_count ?? existing.signer_count) as 1 | 2,
    );
    if (errs.length) {
      return NextResponse.json({ error: "invalid_overlay_fields", details: errs }, { status: 400 });
    }
    update.overlay_fields = body.overlay_fields as OverlayField[];
  }
  if (typeof body.is_active === "boolean") update.is_active = body.is_active;

  // Bump version on every successful save (overlay positions, name, etc.).
  update.version = (existing.version ?? 1) + 1;

  const { data, error } = await supabase
    .from("contract_templates")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) return apiDbError(error.message, "PATCH template/[id] update");

  return NextResponse.json(data);
}

// DELETE /api/settings/contract-templates/[id] — soft archive by flipping
// is_active=false. Templates are never hard-deleted because signed contracts
// in Build 15b will reference them historically.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("contract_templates")
    .update({ is_active: false })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
