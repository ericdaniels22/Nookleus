import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { assertSectionDepth, checkSnapshot, touchEstimate } from "@/lib/estimates";
import { apiDbError } from "@/lib/api-errors";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";
import type { EstimateSection } from "@/lib/types";

interface RouteCtx { params: Promise<{ id: string }> }

interface CreatePayload {
  title: string;
  parent_section_id?: string | null;
  sort_order?: number;
}

interface ReorderPayload {
  sections: Array<{ id: string; sort_order: number; parent_section_id: string | null }>;
  updated_at_snapshot?: string;
}

export async function POST(request: Request, ctx: RouteCtx) {
  const { id: estimateId } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  const { data: estimateRow } = await supabase
    .from("estimates")
    .select("deleted_at")
    .eq("id", estimateId)
    .maybeSingle<{ deleted_at: string | null }>();
  const trashed = assertNotTrashed(estimateRow);
  if (trashed) return trashed;

  const body = (await request.json()) as CreatePayload;
  if (!body.title?.trim()) return NextResponse.json({ error: "title required" }, { status: 400 });

  if (body.parent_section_id) {
    try {
      await assertSectionDepth(body.parent_section_id, supabase);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }

  const orgId = await getActiveOrganizationId(supabase);

  // Compute sort_order if not given
  let sort_order = body.sort_order;
  if (sort_order === undefined) {
    let query = supabase
      .from("estimate_sections")
      .select("sort_order")
      .eq("estimate_id", estimateId);

    if (body.parent_section_id) {
      query = query.eq("parent_section_id", body.parent_section_id);
    } else {
      query = query.is("parent_section_id", null);
    }

    const { data: max } = await query
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle<{ sort_order: number }>();
    sort_order = (max?.sort_order ?? -1) + 1;
  }

  const { data, error } = await supabase
    .from("estimate_sections")
    .insert({
      organization_id: orgId,
      estimate_id: estimateId,
      parent_section_id: body.parent_section_id ?? null,
      title: body.title.trim(),
      sort_order,
    })
    .select("*")
    .single<EstimateSection>();
  if (error) return apiDbError(error.message, "POST /api/estimates/[id]/sections insert");

  return NextResponse.json({ section: data }, { status: 201 });
}

export async function PUT(request: Request, ctx: RouteCtx) {
  const { id: estimateId } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  const { data: estimateRowPut } = await supabase
    .from("estimates")
    .select("deleted_at")
    .eq("id", estimateId)
    .maybeSingle<{ deleted_at: string | null }>();
  const trashedPut = assertNotTrashed(estimateRowPut);
  if (trashedPut) return trashedPut;

  const body = (await request.json()) as ReorderPayload;
  if (!Array.isArray(body.sections)) {
    return NextResponse.json({ error: "sections array required" }, { status: 400 });
  }

  const snap = await checkSnapshot(supabase, estimateId, body.updated_at_snapshot);
  if (!snap.ok) return snap.response;

  for (const s of body.sections) {
    const { error } = await supabase
      .from("estimate_sections")
      .update({ sort_order: s.sort_order, parent_section_id: s.parent_section_id })
      .eq("id", s.id)
      .eq("estimate_id", estimateId);
    if (error) return apiDbError(error.message, "PUT /api/estimates/[id]/sections reorder");
  }

  // Bump the parent estimate's updated_at so future snapshot checks see the change.
  const updated_at = await touchEstimate(supabase, estimateId);

  return NextResponse.json({ ok: true, updated_at });
}
