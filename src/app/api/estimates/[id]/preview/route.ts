// src/app/api/estimates/[id]/preview/route.ts — inline customer-facing PDF.
//
// #385: the View action opens the real customer-facing PDF inline. This GET
// renders the estimate through the existing render pipeline
// (renderEstimatePdfBuffer) and streams the bytes with an inline
// Content-Disposition so the browser renders it in place. No Storage upload —
// a View is a read, so it never persists. Mirrors the established inline
// pattern in /api/pdf-presets/[id]/preview.

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { getDefaultPreset } from "@/lib/pdf-presets";
import {
  renderEstimatePdfBuffer,
  PdfRenderInputError,
} from "@/lib/pdf-renderer/render-and-upload";
import { apiError } from "@/lib/api-errors";

export const GET = withRequestContext(
  { permission: "view_estimates" },
  async (
    _request,
    { supabase, orgId },
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;
    if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });

    const def = await getDefaultPreset(supabase, "estimate");
    if (!def) {
      return NextResponse.json(
        { error: "preset not found (and no default seeded)" },
        { status: 400 },
      );
    }

    try {
      const { buffer, documentNumber } = await renderEstimatePdfBuffer({
        supabase,
        estimateId: id,
        presetId: def.id,
        orgId,
      });
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${documentNumber}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      if (e instanceof PdfRenderInputError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      return apiError(e, "GET /api/estimates/[id]/preview");
    }
  },
);
