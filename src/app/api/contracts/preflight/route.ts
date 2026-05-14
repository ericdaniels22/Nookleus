import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { buildMergeFieldValues } from "@/lib/contracts/merge-fields";
import { evaluateAutoCheckboxes } from "@/lib/contracts/auto-checkbox-evaluator";
import type { OverlayField } from "@/lib/contracts/types";

// GET /api/contracts/preflight?jobId=…&templateId=…
//
// Pre-send check that returns the list of auto-fill checkboxes whose bound
// merge field resolves to null for the target job. Lets the send modal warn
// the sender before they click send (per #70 AC).
export async function GET(request: Request) {
  const authClient = await createServerSupabaseClient();
  const {
    data: { user },
    error: authErr,
  } = await authClient.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  const templateId = url.searchParams.get("templateId");
  if (!jobId || !templateId) {
    return NextResponse.json(
      { error: "jobId and templateId are required" },
      { status: 400 },
    );
  }

  const orgId = await getActiveOrganizationId(authClient);
  const supabase = createServiceClient();

  const { data: tpl } = await supabase
    .from("contract_templates")
    .select("overlay_fields")
    .eq("id", templateId)
    .eq("organization_id", orgId)
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

  const resolvedValues = await buildMergeFieldValues(supabase, jobId);
  const evaluation = evaluateAutoCheckboxes(overlayFields, resolvedValues);

  const detail = evaluation.unresolved.map((inputKey) => {
    const field = autoBound.find((f) => f.inputKey === inputKey);
    return {
      inputKey,
      mergeFieldName: field?.autoFillBinding?.mergeFieldName ?? "",
    };
  });

  return NextResponse.json({ unresolvedAutoCheckboxes: detail });
}
