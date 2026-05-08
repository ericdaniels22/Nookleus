import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { apiDbError } from "@/lib/api-errors";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";
import { checkSnapshot, touchEntity, roundMoney } from "@/lib/builder-shared";
import { recalculateInvoiceTotals } from "@/lib/invoices";

interface PostBody {
  section_id: string;
  // Library-backed:
  library_item_id?: string;
  name?: string | null;
  // Custom:
  description?: string;
  quantity?: number;
  unit?: string | null;
  unit_price?: number;
  code?: string | null;
  sort_order?: number;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_invoices");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  const { data: invoiceRow } = await supabase
    .from("invoices")
    .select("deleted_at")
    .eq("id", id)
    .maybeSingle<{ deleted_at: string | null }>();
  const trashed = assertNotTrashed(invoiceRow);
  if (trashed) return trashed;

  const body = (await request.json().catch(() => null)) as PostBody | null;
  if (!body || typeof body.section_id !== "string") {
    return NextResponse.json({ error: "section_id required" }, { status: 400 });
  }

  try {
    // Confirm section belongs to this invoice
    const { data: sec } = await supabase
      .from("invoice_sections").select("id").eq("id", body.section_id).eq("invoice_id", id).maybeSingle<{ id: string }>();
    if (!sec) return NextResponse.json({ error: "section_not_found" }, { status: 400 });

    const orgId = await getActiveOrganizationId(supabase);
    if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });

    let lineRow: Record<string, unknown>;

    if (body.library_item_id) {
      const { data: lib } = await supabase
        .from("item_library")
        .select("name, description, code, default_quantity, default_unit, unit_price")
        .eq("id", body.library_item_id)
        .eq("is_active", true)
        .maybeSingle<{
          name: string;
          description: string;
          code: string | null;
          default_quantity: number;
          default_unit: string | null;
          unit_price: number;
        }>();
      if (!lib) return NextResponse.json({ error: "library_item_not_found_or_inactive" }, { status: 400 });

      const qty = body.quantity ?? Number(lib.default_quantity);
      const overridePrice = body.unit_price !== undefined ? Number(body.unit_price) : Number(lib.unit_price);
      if (!Number.isFinite(overridePrice)) {
        return NextResponse.json({ error: "unit_price must be finite" }, { status: 400 });
      }
      lineRow = {
        organization_id: orgId,
        invoice_id: id,
        section_id: body.section_id,
        library_item_id: body.library_item_id,
        name: lib.name,
        description: lib.description,
        code: lib.code,
        quantity: qty,
        unit: lib.default_unit,
        unit_price: overridePrice,
        amount: roundMoney(qty * overridePrice),
        sort_order: body.sort_order ?? 0,
      };
    } else {
      if (typeof body.description !== "string" || !body.description.trim()) {
        return NextResponse.json({ error: "description required for custom item" }, { status: 400 });
      }
      let customName: string | null = null;
      if (body.name !== undefined && body.name !== null) {
        if (typeof body.name !== "string") {
          return NextResponse.json({ error: "name must be a string" }, { status: 400 });
        }
        const trimmed = body.name.trim();
        if (trimmed.length > 200) {
          return NextResponse.json({ error: "name too long (max 200)" }, { status: 400 });
        }
        customName = trimmed.length > 0 ? trimmed : null;
      }
      const qty = Number(body.quantity ?? 1);
      const price = Number(body.unit_price ?? 0);
      if (!Number.isFinite(qty) || qty < 0) {
        return NextResponse.json({ error: "quantity must be a non-negative number" }, { status: 400 });
      }
      if (!Number.isFinite(price)) {
        return NextResponse.json({ error: "unit_price must be finite" }, { status: 400 });
      }
      lineRow = {
        organization_id: orgId,
        invoice_id: id,
        section_id: body.section_id,
        library_item_id: null,
        name: customName,
        description: body.description,
        code: body.code ?? null,
        quantity: qty,
        unit: body.unit ?? null,
        unit_price: price,
        amount: roundMoney(qty * price),
        sort_order: body.sort_order ?? 0,
      };
    }

    const { data, error } = await supabase.from("invoice_line_items").insert(lineRow).select().single();
    if (error) throw error;
    await recalculateInvoiceTotals(supabase, id);
    await touchEntity(supabase, "invoices", id);
    return NextResponse.json({ line_item: data });
  } catch (e: unknown) {
    return apiDbError(e instanceof Error ? e.message : String(e), "POST /api/invoices/[id]/line-items");
  }
}

interface PutBody {
  reorder: Array<{
    id: string;
    section_id: string;
    sort_order: number;
  }>;
  updated_at_snapshot?: string;
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_invoices");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  const { data: invoiceRowPut } = await supabase
    .from("invoices")
    .select("deleted_at")
    .eq("id", id)
    .maybeSingle<{ deleted_at: string | null }>();
  const trashedPut = assertNotTrashed(invoiceRowPut);
  if (trashedPut) return trashedPut;

  const body = (await request.json().catch(() => null)) as PutBody | null;
  if (!body || !Array.isArray(body.reorder)) {
    return NextResponse.json({ error: "reorder array required" }, { status: 400 });
  }

  try {
    const { stale, current } = await checkSnapshot(supabase, "invoices", id, body.updated_at_snapshot);
    if (stale) {
      return NextResponse.json(
        { error: "stale_snapshot", current_updated_at: current },
        { status: current === null ? 404 : 409 },
      );
    }

    // Pre-validate every section_id belongs to this invoice (defense-in-depth — RLS catches cross-org)
    const sectionIds = Array.from(new Set(body.reorder.map((r) => r.section_id)));
    const { data: sections } = await supabase
      .from("invoice_sections").select("id").in("id", sectionIds).eq("invoice_id", id);
    const validIds = new Set((sections ?? []).map((s) => s.id));
    for (const r of body.reorder) {
      if (!validIds.has(r.section_id)) {
        return NextResponse.json({ error: "section_not_in_invoice", section_id: r.section_id }, { status: 400 });
      }
    }

    for (const r of body.reorder) {
      const { error } = await supabase
        .from("invoice_line_items")
        .update({ section_id: r.section_id, sort_order: r.sort_order })
        .eq("id", r.id);
      if (error) throw error;
    }
    await touchEntity(supabase, "invoices", id);
    const { data: now } = await supabase.from("invoices").select("updated_at").eq("id", id).maybeSingle<{ updated_at: string }>();
    return NextResponse.json({ ok: true, updated_at: now?.updated_at });
  } catch (e: unknown) {
    return apiDbError(e instanceof Error ? e.message : String(e), "PUT /api/invoices/[id]/line-items reorder");
  }
}
