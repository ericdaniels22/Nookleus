import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { apiDbError } from "@/lib/api-errors";
import {
  getTemplateWithContents,
  updateTemplate,
  deactivateTemplate,
  serializeStructureFromBuilder,
} from "@/lib/estimate-templates";
import type { TemplateStructure, TemplateWithContents } from "@/lib/types";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "view_estimates");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  try {
    const tmpl = await getTemplateWithContents(supabase, id);
    if (!tmpl) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(tmpl);
  } catch (e: unknown) {
    return apiDbError(e instanceof Error ? e.message : String(e), "GET /api/estimate-templates/[id]");
  }
}

interface PutBody {
  name?: string;
  description?: string | null;
  damage_type_tags?: string[];
  opening_statement?: string | null;
  closing_statement?: string | null;
  /** Either:
   *  (a) Full structure JSONB (provided by the template editor's rootPut serialization), or
   *  (b) builder-shape projection (TemplateWithContents.sections) — server converts via serializeStructureFromBuilder.
   *  Prefer (a); the route accepts (b) only for resilience. */
  structure?: TemplateStructure;
  builder_state?: TemplateWithContents;
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "manage_templates");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as PutBody | null;
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  try {
    const patch: Parameters<typeof updateTemplate>[2] = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.damage_type_tags !== undefined) patch.damage_type_tags = body.damage_type_tags;
    if (body.opening_statement !== undefined) patch.opening_statement = body.opening_statement;
    if (body.closing_statement !== undefined) patch.closing_statement = body.closing_statement;

    // Structure: prefer explicit; else compute from builder_state
    if (body.structure !== undefined) {
      patch.structure = body.structure;
    } else if (body.builder_state !== undefined) {
      patch.structure = serializeStructureFromBuilder(body.builder_state);
    }

    const tmpl = await updateTemplate(supabase, id, patch);
    return NextResponse.json(tmpl);
  } catch (e: unknown) {
    return apiDbError(e instanceof Error ? e.message : String(e), "PUT /api/estimate-templates/[id]");
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "manage_templates");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  try {
    await deactivateTemplate(supabase, id);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiDbError(e instanceof Error ? e.message : String(e), "DELETE /api/estimate-templates/[id]");
  }
}
