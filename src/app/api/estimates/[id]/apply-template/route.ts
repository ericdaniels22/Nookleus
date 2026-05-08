import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { apiDbError } from "@/lib/api-errors";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";
import { applyTemplate } from "@/lib/estimate-templates";
import { recalculateTotals } from "@/lib/estimates";

interface PostBody {
  template_id: string;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_estimates");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  const { data: estimateRow } = await supabase
    .from("estimates")
    .select("deleted_at")
    .eq("id", id)
    .maybeSingle<{ deleted_at: string | null }>();
  const trashed = assertNotTrashed(estimateRow);
  if (trashed) return trashed;

  const body = (await request.json().catch(() => null)) as PostBody | null;
  if (!body || typeof body.template_id !== "string") {
    return NextResponse.json({ error: "template_id required" }, { status: 400 });
  }

  try {
    const result = await applyTemplate(supabase, id, body.template_id);
    if (!result.ok) {
      const statusByCode = {
        estimate_not_found: 404,
        estimate_not_draft: 400,
        estimate_not_empty: 400,
        template_not_found_or_inactive: 404,
        internal: 500,
      } as const;
      return NextResponse.json(
        { error: result.code, message: "message" in result ? result.message : undefined },
        { status: statusByCode[result.code] },
      );
    }

    // Recalc totals server-side after RPC populates rows
    await recalculateTotals(id, supabase);

    return NextResponse.json({
      section_count: result.section_count,
      line_item_count: result.line_item_count,
      broken_refs: result.broken_refs,
    });
  } catch (e: unknown) {
    return apiDbError(e instanceof Error ? e.message : String(e), "POST /api/estimates/[id]/apply-template");
  }
}
