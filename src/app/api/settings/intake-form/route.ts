import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { findBlockedRemovals } from "@/lib/contracts/form-config-removal-guard";
import type { FormConfig } from "@/lib/types";

// GET /api/settings/intake-form — fetch latest form config for the active org.
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("form_config")
    .select("*")
    .eq("organization_id", await getActiveOrganizationId(supabase))
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || { config: { sections: [] }, version: 0 });
}

// POST /api/settings/intake-form — save new version (org-scoped).
export async function POST(request: Request) {
  const { config } = await request.json();

  if (!config || !config.sections) {
    return NextResponse.json({ error: "Invalid config" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const orgId = await getActiveOrganizationId(supabase);

  // Get current latest version + config for this org
  const { data: current } = await supabase
    .from("form_config")
    .select("version, config")
    .eq("organization_id", orgId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const priorConfig: FormConfig | null = current?.config ?? null;

  // Block deletes that would orphan contract-template merge references.
  try {
    const blocked = await findBlockedRemovals(supabase, priorConfig, config);
    if (blocked.length > 0) {
      return NextResponse.json(
        {
          error: "field_referenced_by_templates",
          blocked,
        },
        { status: 409 },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reference check failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const nextVersion = (current?.version ?? 0) + 1;

  const { data, error } = await supabase
    .from("form_config")
    .insert({
      organization_id: orgId,
      config,
      version: nextVersion,
      created_by: "admin",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
