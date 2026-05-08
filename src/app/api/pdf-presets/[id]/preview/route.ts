// src/app/api/pdf-presets/[id]/preview/route.ts — inline sample PDF.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireAnyPermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { getPreset } from "@/lib/pdf-presets";
import { renderPdf } from "@/lib/pdf-renderer/render";
import { buildSampleInput } from "@/lib/sample-pdf-data";
import { apiError } from "@/lib/api-errors";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requireAnyPermission(supabase, ["view_estimates", "view_invoices"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const orgId = await getActiveOrganizationId(supabase);
  if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });

  try {
    const preset = await getPreset(supabase, id);
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
}
