import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { findBlockedRemovals } from "@/lib/contracts/form-config-removal-guard";
import type { FormConfig } from "@/lib/types";

// POST /api/settings/intake-form/restore — copy an older version forward as a new row.
// Never mutates or deletes prior versions.
// Logged-in only — previously ungated (recorded for the #78 ungated list).
export const POST = withRequestContext({}, async (request, ctx) => {
  const body = await request.json().catch(() => ({}));
  const targetVersion = Number(body?.version);
  if (!Number.isFinite(targetVersion) || targetVersion < 1) {
    return NextResponse.json({ error: "Invalid version" }, { status: 400 });
  }

  const orgId = ctx.orgId;

  const { data: target, error: fetchErr } = await ctx.supabase
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

  const { data: latest, error: latestErr } = await ctx.supabase
    .from("form_config")
    .select("version, config")
    .eq("organization_id", orgId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestErr) {
    return NextResponse.json({ error: latestErr.message }, { status: 500 });
  }

  // Restoring an older version effectively removes any fields that exist on
  // the current latest version but are absent from the target. Block the
  // restore if any of those removed fields are referenced by contract
  // templates.
  const priorConfig: FormConfig | null = latest?.config ?? null;
  try {
    const blocked = await findBlockedRemovals(ctx.supabase, priorConfig, target.config);
    if (blocked.length > 0) {
      return NextResponse.json(
        { error: "field_referenced_by_templates", blocked },
        { status: 409 },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reference check failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const nextVersion = (latest?.version ?? 0) + 1;

  const { error: insertErr } = await ctx.supabase
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
});
