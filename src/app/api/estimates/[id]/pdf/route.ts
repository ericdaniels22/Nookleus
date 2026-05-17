// src/app/api/estimates/[id]/pdf/route.ts — render → upload → signed URL.
//
// Build 67c2: body extracted into renderAndUploadEstimatePdf so the new
// send route can share the exact rendering / Storage path. The route
// keeps the "no body.preset_id → use default preset" fallback and the
// public response shape `{ download_url, storage_path, filename }`.

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { getDefaultPreset } from "@/lib/pdf-presets";
import { renderAndUploadEstimatePdf, PdfRenderInputError } from "@/lib/pdf-renderer/render-and-upload";
import { apiError } from "@/lib/api-errors";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";

interface PdfRequestBody { preset_id?: string; }

export const POST = withRequestContext(
  { permission: "view_estimates" },
  async (request, { supabase, orgId }, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });

    const { data: estimateRow } = await supabase
      .from("estimates")
      .select("deleted_at")
      .eq("id", id)
      .maybeSingle<{ deleted_at: string | null }>();
    const trashed = assertNotTrashed(estimateRow);
    if (trashed) return trashed;

    let body: PdfRequestBody = {};
    try { body = (await request.json().catch(() => ({}))) as PdfRequestBody; }
    catch { /* empty body OK; default preset will be used */ }

    let presetId = body.preset_id;
    if (!presetId) {
      const def = await getDefaultPreset(supabase, "estimate");
      if (!def) {
        return NextResponse.json(
          { error: "preset not found (and no default seeded)" },
          { status: 400 },
        );
      }
      presetId = def.id;
    }

    try {
      const result = await renderAndUploadEstimatePdf({
        supabase,
        estimateId: id,
        presetId,
        orgId,
      });
      return NextResponse.json({
        download_url: result.download_url,
        storage_path: result.storage_path,
        filename: result.filename,
      });
    } catch (e) {
      if (e instanceof PdfRenderInputError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      return apiError(e, "POST /api/estimates/[id]/pdf");
    }
  },
);
