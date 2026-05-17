import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import { listTemplates, createTemplate } from "@/lib/estimate-templates";

// Listing templates needs the `view_estimates` permission (admins
// auto-pass) — mapped 1:1 from the old gate.
export const GET = withRequestContext(
  { permission: "view_estimates" },
  async (request, ctx) => {
    const url = new URL(request.url);
    const search = url.searchParams.get("search") ?? undefined;
    const damageType = url.searchParams.get("damage_type") ?? undefined;
    const isActiveParam = url.searchParams.get("is_active");
    const isActive =
      isActiveParam === "true" ? true :
      isActiveParam === "false" ? false :
      null;

    try {
      const orgId = ctx.orgId;
      if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });
      const rows = await listTemplates(ctx.supabase, orgId, { search, damageType, isActive });
      return NextResponse.json({ rows });
    } catch (e: unknown) {
      return apiDbError(e instanceof Error ? e.message : String(e), "GET /api/estimate-templates list");
    }
  },
);

interface PostBody {
  name: string;
  description?: string | null;
  damage_type_tags?: string[];
  opening_statement?: string | null;
  closing_statement?: string | null;
}

// Creating a template needs the `manage_templates` permission (admins
// auto-pass) — mapped 1:1 from the old gate.
export const POST = withRequestContext(
  { permission: "manage_templates" },
  async (request, ctx) => {
    const body = (await request.json().catch(() => null)) as PostBody | null;
    if (!body || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }

    try {
      const orgId = ctx.orgId;
      if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });
      const tmpl = await createTemplate(ctx.supabase, orgId, ctx.userId, {
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
  },
);
