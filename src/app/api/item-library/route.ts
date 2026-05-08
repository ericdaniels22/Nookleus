import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission, requireAnyPermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { listItems, createItem } from "@/lib/item-library";
import { apiError } from "@/lib/api-errors";
import type { ItemCategory } from "@/lib/types";

const VALID_CATEGORIES: ItemCategory[] = [
  "labor", "equipment", "materials", "services", "other",
];

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const auth = await requireAnyPermission(supabase, ["view_estimates", "view_invoices"]);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const search = url.searchParams.get("search") ?? undefined;
  const categoryRaw = url.searchParams.get("category");
  const damage_type = url.searchParams.get("damage_type") ?? undefined;
  const isActiveRaw = url.searchParams.get("is_active");

  let category: ItemCategory | undefined;
  if (categoryRaw) {
    if (!VALID_CATEGORIES.includes(categoryRaw as ItemCategory)) {
      return NextResponse.json({ error: "invalid category" }, { status: 400 });
    }
    category = categoryRaw as ItemCategory;
  }

  let is_active: boolean | undefined;
  if (isActiveRaw !== null) {
    if (isActiveRaw === "true") is_active = true;
    else if (isActiveRaw === "false") is_active = false;
    else return NextResponse.json({ error: "is_active must be true|false" }, { status: 400 });
  } else {
    is_active = true; // default to active-only
  }

  try {
    const items = await listItems({ search, category, damage_type, is_active }, supabase);
    return NextResponse.json({ items });
  } catch (e) {
    return apiError(e, "GET /api/item-library list");
  }
}

interface CreatePayload {
  name?: string;
  description?: string;
  code?: string | null;
  category?: ItemCategory;
  default_quantity?: number;
  default_unit?: string | null;
  unit_price?: number;
  damage_type_tags?: string[];
  section_tags?: string[];
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "manage_item_library");
  if (!auth.ok) return auth.response;

  let body: CreatePayload;
  try {
    body = (await request.json()) as CreatePayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Required fields
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (typeof body.description !== "string") {
    return NextResponse.json({ error: "description required" }, { status: 400 });
  }
  if (!body.category || !VALID_CATEGORIES.includes(body.category)) {
    return NextResponse.json({ error: "valid category required" }, { status: 400 });
  }
  if (typeof body.default_quantity !== "number" || !Number.isFinite(body.default_quantity)) {
    return NextResponse.json({ error: "default_quantity must be a number" }, { status: 400 });
  }
  if (typeof body.unit_price !== "number" || !Number.isFinite(body.unit_price)) {
    return NextResponse.json({ error: "unit_price must be a number" }, { status: 400 });
  }
  const name = body.name.trim();
  if (name.length > 200) {
    return NextResponse.json({ error: "name too long (max 200)" }, { status: 400 });
  }
  if (body.description.length > 2000) {
    return NextResponse.json({ error: "description too long (max 2000)" }, { status: 400 });
  }
  if (body.code !== undefined && body.code !== null && typeof body.code !== "string") {
    return NextResponse.json({ error: "code must be a string or null" }, { status: 400 });
  }
  if (body.default_unit !== undefined && body.default_unit !== null && typeof body.default_unit !== "string") {
    return NextResponse.json({ error: "default_unit must be a string or null" }, { status: 400 });
  }

  const orgId = await getActiveOrganizationId(supabase);
  if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });

  try {
    const item = await createItem(
      {
        name,
        description: body.description,
        code: body.code ?? null,
        category: body.category,
        default_quantity: body.default_quantity,
        default_unit: body.default_unit ?? null,
        unit_price: body.unit_price,
        damage_type_tags: body.damage_type_tags ?? [],
        section_tags: body.section_tags ?? [],
      },
      orgId,
      auth.userId,
      supabase,
    );
    return NextResponse.json({ item }, { status: 201 });
  } catch (e) {
    return apiError(e, "POST /api/item-library");
  }
}
