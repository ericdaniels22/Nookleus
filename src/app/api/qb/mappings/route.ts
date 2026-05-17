import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";
import type { QbMappingType } from "@/lib/qb/types";

// GET /api/qb/mappings?type=... — all mappings, or one type.
async function getMappings(request: Request, ctx: RequestContext) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") as QbMappingType | null;

  const service = ctx.serviceClient!;
  let query = service
    .from("qb_mappings")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .order("platform_value", { ascending: true });
  if (type) query = query.eq("type", type);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ mappings: data ?? [] });
}

// PUT /api/qb/mappings — replace the full mapping set for a given type.
// Body: { type: 'damage_type' | 'payment_method' | 'expense_category',
//         mappings: Array<{ platform_value, qb_entity_id, qb_entity_name }> }
// We delete existing rows of that type and insert the new set in one
// transaction (well, two statements — good enough for a single-admin UI
// with no concurrent writers).
async function putMappings(request: Request, ctx: RequestContext) {
  const body = (await request.json()) as {
    type: QbMappingType;
    mappings: Array<{
      platform_value: string;
      qb_entity_id: string;
      qb_entity_name: string;
    }>;
  };

  if (!body.type || !Array.isArray(body.mappings)) {
    return NextResponse.json({ error: "type and mappings required" }, { status: 400 });
  }

  const orgId = ctx.orgId;
  const service = ctx.serviceClient!;
  const { error: delErr } = await service
    .from("qb_mappings")
    .delete()
    .eq("type", body.type)
    .eq("organization_id", orgId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  if (body.mappings.length > 0) {
    const rows = body.mappings.map((m) => ({
      organization_id: orgId,
      type: body.type,
      platform_value: m.platform_value,
      qb_entity_id: m.qb_entity_id,
      qb_entity_name: m.qb_entity_name,
    }));
    const { error: insErr } = await service.from("qb_mappings").insert(rows);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export const GET = withRequestContext(
  { adminOnly: true, serviceClient: true },
  getMappings,
);

export const PUT = withRequestContext(
  { adminOnly: true, serviceClient: true },
  putMappings,
);
