import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

// GET /api/settings/intake-form/versions — last 20 versions for the active org.
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const orgId = await getActiveOrganizationId(supabase);

  const { data, error } = await supabase
    .from("form_config")
    .select("version, created_by, created_at")
    .eq("organization_id", orgId)
    .order("version", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ versions: data ?? [] });
}
