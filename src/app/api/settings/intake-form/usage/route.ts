import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { findReferencingTemplates } from "@/lib/contracts/template-reference-lookup";
import type { FormConfig } from "@/lib/types";

// GET /api/settings/intake-form/usage
// Returns { usage: { [slug]: [{ id, name, is_active }] } } for every slug
// derived from the active org's latest form_config (slug = merge_field_slug ?? id).
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const orgId = await getActiveOrganizationId(supabase);

  const { data: cfgRow, error: cfgErr } = await supabase
    .from("form_config")
    .select("config")
    .eq("organization_id", orgId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cfgErr) return NextResponse.json({ error: cfgErr.message }, { status: 500 });

  const config: FormConfig = cfgRow?.config ?? { sections: [] };
  const slugs = new Set<string>();
  for (const section of config.sections) {
    for (const field of section.fields) {
      slugs.add(field.merge_field_slug ?? field.id);
    }
  }

  if (slugs.size === 0) return NextResponse.json({ usage: {} });

  try {
    const usage = await findReferencingTemplates(supabase, [...slugs]);
    return NextResponse.json({ usage });
  } catch (err) {
    const message = err instanceof Error ? err.message : "lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
