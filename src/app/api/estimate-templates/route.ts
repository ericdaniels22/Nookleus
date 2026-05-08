import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { apiDbError } from "@/lib/api-errors";
import { listTemplates, createTemplate } from "@/lib/estimate-templates";

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "view_estimates");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const search = url.searchParams.get("search") ?? undefined;
  const damageType = url.searchParams.get("damage_type") ?? undefined;
  const isActiveParam = url.searchParams.get("is_active");
  const isActive =
    isActiveParam === "true" ? true :
    isActiveParam === "false" ? false :
    null;

  try {
    const orgId = await getActiveOrganizationId(supabase);
    if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });
    const rows = await listTemplates(supabase, orgId, { search, damageType, isActive });
    return NextResponse.json({ rows });
  } catch (e: unknown) {
    return apiDbError(e instanceof Error ? e.message : String(e), "GET /api/estimate-templates list");
  }
}

interface PostBody {
  name: string;
  description?: string | null;
  damage_type_tags?: string[];
  opening_statement?: string | null;
  closing_statement?: string | null;
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "manage_templates");
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as PostBody | null;
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  try {
    const orgId = await getActiveOrganizationId(supabase);
    if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const tmpl = await createTemplate(supabase, orgId, user.id, {
      name: body.name,
      description: body.description ?? null,
      damage_type_tags: body.damage_type_tags ?? [],
      opening_statement: body.opening_statement ?? null,
      closing_statement: body.closing_statement ?? null,
    });
    return NextResponse.json(tmpl);
  } catch (e: unknown) {
    return apiDbError(e instanceof Error ? e.message : String(e), "POST /api/estimate-templates create");
  }
}
