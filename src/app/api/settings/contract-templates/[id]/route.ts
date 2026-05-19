import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import type { OverlayField, PdfPage } from "@/lib/contracts/types";
import { validateOverlayFields } from "@/lib/contracts/overlay-validation";
import { buildMergeFieldRegistry } from "@/lib/contracts/merge-field-registry";
import { SYSTEM_MERGE_FIELDS } from "@/lib/contracts/merge-fields";
import type { FormConfig } from "@/lib/types";

// GET /api/settings/contract-templates/[id]
// Requires `access_settings` (#107) — tightened from the logged-in-only gate.
// Org-scoped (#98): a template in another Organization is indistinguishable
// from a missing one — both return 404.
export const GET = withRequestContext(
  { permission: "access_settings" },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const { data, error } = await ctx.supabase
      .from("contract_templates")
      .select("*")
      .eq("id", id)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    return NextResponse.json(data);
  },
);

// PATCH /api/settings/contract-templates/[id] — auto-save handler.
// 409 stale-check via the version column (mirrors 67a auto-save).
// overlay_fields validated server-side.
export const PATCH = withRequestContext(
  { permission: "manage_contract_templates" },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const orgId = ctx.orgId;

    const body = await request.json().catch(() => ({}));

    // Fetch existing for stale-check + validation context.
    const { data: existing, error: fetchErr } = await ctx.supabase
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
      const { data: form } = await ctx.supabase
        .from("form_config")
        .select("config")
        .eq("organization_id", orgId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle<{ config: FormConfig }>();
      const formConfig: FormConfig = form?.config ?? { sections: [] };
      const registry = buildMergeFieldRegistry(formConfig, SYSTEM_MERGE_FIELDS);
      const knownMergeNames = new Set(registry.map((r) => r.slug));

      const errs = validateOverlayFields(
        body.overlay_fields as OverlayField[],
        (existing.pdf_pages ?? null) as PdfPage[] | null,
        (update.signer_count ?? existing.signer_count) as 1 | 2,
        knownMergeNames,
      );
      if (errs.length) {
        return NextResponse.json({ error: "invalid_overlay_fields", details: errs }, { status: 400 });
      }
      update.overlay_fields = body.overlay_fields as OverlayField[];
    }
    if (typeof body.is_active === "boolean") update.is_active = body.is_active;

    // Bump version on every successful save (overlay positions, name, etc.).
    update.version = (existing.version ?? 1) + 1;

    const { data, error } = await ctx.supabase
      .from("contract_templates")
      .update(update)
      .eq("id", id)
      .select()
      .single();
    if (error) return apiDbError(error.message, "PATCH template/[id] update");

    return NextResponse.json(data);
  },
);

// DELETE /api/settings/contract-templates/[id] — soft archive by flipping
// is_active=false. Templates are never hard-deleted because signed contracts
// in Build 15b will reference them historically.
//
// Requires `access_settings` (#107) — tightened from the logged-in-only gate.
// Org-scoped (#98): the update filters on the Active Organization, so a
// template in another Organization cannot be archived and is indistinguishable
// from a missing one — both return 404.
export const DELETE = withRequestContext(
  { permission: "access_settings" },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const { data, error } = await ctx.supabase
      .from("contract_templates")
      .update({ is_active: false })
      .eq("id", id)
      .eq("organization_id", ctx.orgId)
      .select("id")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  },
);
