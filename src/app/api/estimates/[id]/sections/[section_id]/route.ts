import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { recalculateTotals } from "@/lib/estimates";
import { apiDbError } from "@/lib/api-errors";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";

interface RouteCtx { params: Promise<{ id: string; section_id: string }> }

interface RenamePayload {
  title?: string;
}

export async function PUT(request: Request, ctx: RouteCtx) {
  const { id: estimateId, section_id: sectionId } = await ctx.params;
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

  let body: RenamePayload;
  try {
    body = (await request.json()) as RenamePayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  const title = body.title.trim();
  if (title.length > 200) {
    return NextResponse.json({ error: "title too long (max 200)" }, { status: 400 });
  }

  // Verify the section belongs to this estimate (defense-in-depth past RLS)
  const { data: existing } = await supabase
    .from("estimate_sections")
    .select("id")
    .eq("id", sectionId)
    .eq("estimate_id", estimateId)
    .maybeSingle<{ id: string }>();
  if (!existing) {
    return NextResponse.json({ error: "section not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("estimate_sections")
    .update({ title })
    .eq("id", sectionId)
    .eq("estimate_id", estimateId)
    .select("*")
    .single();
  if (error) return apiDbError(error.message, "PUT /api/estimates/[id]/sections/[section_id] rename");

  return NextResponse.json({ section: data });
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const { id: estimateId, section_id: sectionId } = await ctx.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  const { data: estimateRowDel } = await supabase
    .from("estimates")
    .select("deleted_at")
    .eq("id", estimateId)
    .maybeSingle<{ deleted_at: string | null }>();
  const trashedDel = assertNotTrashed(estimateRowDel);
  if (trashedDel) return trashedDel;

  const { data: existing } = await supabase
    .from("estimate_sections")
    .select("id")
    .eq("id", sectionId)
    .eq("estimate_id", estimateId)
    .maybeSingle<{ id: string }>();
  if (!existing) {
    return NextResponse.json({ error: "section not found" }, { status: 404 });
  }

  // Cascade — DB-level FK ON DELETE CASCADE on estimate_sections handles
  // child subsections + estimate_line_items pointing at this section.
  const { error } = await supabase
    .from("estimate_sections")
    .delete()
    .eq("id", sectionId)
    .eq("estimate_id", estimateId);
  if (error) return apiDbError(error.message, "DELETE /api/estimates/[id]/sections/[section_id]");

  // Recalc — items just disappeared, subtotal needs to reflect that.
  await recalculateTotals(estimateId, supabase);

  return NextResponse.json({ ok: true });
}
