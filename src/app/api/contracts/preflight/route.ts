import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { buildMergeFieldRawValues } from "@/lib/contracts/merge-fields";
import { evaluateAutoCheckboxes } from "@/lib/contracts/auto-checkbox-evaluator";
import type { OverlayField } from "@/lib/contracts/types";

// GET /api/contracts/preflight?jobId=…&templateId=…
//
// Pre-send check that returns the list of auto-fill checkboxes whose bound
// merge field resolves to null for the target job. Lets the send modal warn
// the sender before they click send (per #70 AC).
//
// Logged-in only; the Service client reads the template + merge values,
// scoped to the caller's Active Organization.
export const GET = withRequestContext(
  { serviceClient: true },
  async (request, ctx) => {
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");
    const templateId = url.searchParams.get("templateId");
    if (!jobId || !templateId) {
      return NextResponse.json(
        { error: "jobId and templateId are required" },
        { status: 400 },
      );
    }

    const supabase = ctx.serviceClient!;

    const { data: tpl } = await supabase
      .from("contract_templates")
      .select("overlay_fields")
      .eq("id", templateId)
      .eq("organization_id", ctx.orgId)
      .maybeSingle<{ overlay_fields: OverlayField[] | null }>();
    if (!tpl) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const overlayFields = tpl.overlay_fields ?? [];
    const autoBound = overlayFields.filter(
      (f) => f.type === "checkbox" && f.autoFillBinding,
    );
    if (!autoBound.length) {
      return NextResponse.json({ unresolvedAutoCheckboxes: [] });
    }

    const resolvedValues = await buildMergeFieldRawValues(supabase, jobId);
    const evaluation = evaluateAutoCheckboxes(overlayFields, resolvedValues);

    const detail = evaluation.unresolved.map((inputKey) => {
      const field = autoBound.find((f) => f.inputKey === inputKey);
      return {
        inputKey,
        mergeFieldName: field?.autoFillBinding?.mergeFieldName ?? "",
      };
    });

    return NextResponse.json({ unresolvedAutoCheckboxes: detail });
  },
);
