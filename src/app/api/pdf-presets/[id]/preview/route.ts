// src/app/api/pdf-presets/[id]/preview/route.ts — inline sample PDF.

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { getPreset } from "@/lib/pdf-presets";
import { renderPdf } from "@/lib/pdf-renderer/render";
import { buildSampleInput } from "@/lib/sample-pdf-data";
import { apiError } from "@/lib/api-errors";

// Rendering a preset preview needs either the estimates or the invoices
// view permission (admins auto-pass) — mapped 1:1 from the old gate.
export const GET = withRequestContext(
  { permission: ["view_estimates", "view_invoices"] },
  async (_request, ctx, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const orgId = ctx.orgId;
    if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });

    try {
      const preset = await getPreset(ctx.supabase, id);
      if (!preset) return NextResponse.json({ error: "not found" }, { status: 404 });
      const input = buildSampleInput(preset, orgId);
      const buffer = await renderPdf(input);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="preset-preview.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      return apiError(e, "GET /api/pdf-presets/[id]/preview render");
    }
  },
);
