import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

// POST /api/settings/intake-form/restore — copy an older version forward as a new row.
// Never mutates or deletes prior versions.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const targetVersion = Number(body?.version);
  if (!Number.isFinite(targetVersion) || targetVersion < 1) {
    return NextResponse.json({ error: "Invalid version" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const orgId = await getActiveOrganizationId(supabase);

  const { data: target, error: fetchErr } = await supabase
    .from("form_config")
    .select("config")
    .eq("organization_id", orgId)
    .eq("version", targetVersion)
    .single();

  if (fetchErr || !target) {
    return NextResponse.json(
      { error: fetchErr?.message ?? "Version not found" },
      { status: 404 }
    );
  }

  const { data: latest, error: latestErr } = await supabase
    .from("form_config")
    .select("version")
    .eq("organization_id", orgId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestErr) {
    return NextResponse.json({ error: latestErr.message }, { status: 500 });
  }

  const nextVersion = (latest?.version ?? 0) + 1;

  const { error: insertErr } = await supabase
    .from("form_config")
    .insert({
      organization_id: orgId,
      version: nextVersion,
      config: target.config,
      created_by: "admin",
    });

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({
    version: nextVersion,
    config: target.config,
  });
}
