import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";
import { checkSnapshot, touchEntity } from "@/lib/builder-shared";

interface PostBody {
  title: string;
  parent_section_id?: string | null;
  sort_order?: number;
}

export const POST = withRequestContext(
  { permission: "edit_invoices" },
  async (request, { supabase, orgId }, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const { data: invoiceRow } = await supabase
      .from("invoices")
      .select("deleted_at")
      .eq("id", id)
      .maybeSingle<{ deleted_at: string | null }>();
    const trashed = assertNotTrashed(invoiceRow);
    if (trashed) return trashed;

    const body = (await request.json().catch(() => null)) as PostBody | null;
    if (!body || typeof body.title !== "string") {
      return NextResponse.json({ error: "title required" }, { status: 400 });
    }

    try {
      // Enforce one-level-only nesting
      if (body.parent_section_id) {
        const { data: parent } = await supabase
          .from("invoice_sections").select("parent_section_id").eq("id", body.parent_section_id).maybeSingle<{ parent_section_id: string | null }>();
        if (!parent) return NextResponse.json({ error: "parent_not_found" }, { status: 400 });
        if (parent.parent_section_id !== null) {
          return NextResponse.json({ error: "max_one_level_nesting" }, { status: 400 });
        }
      }

      if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });

      const { data, error } = await supabase
        .from("invoice_sections")
        .insert({
          organization_id: orgId,
          invoice_id: id,
          parent_section_id: body.parent_section_id ?? null,
          title: body.title,
          sort_order: body.sort_order ?? 0,
        })
        .select()
        .single();
      if (error) throw error;

      await touchEntity(supabase, "invoices", id);
      // Shape must match the estimates sections route — the shared
      // estimate-builder client destructures `{ section }` from the response.
      return NextResponse.json({ section: data }, { status: 201 });
    } catch (e: unknown) {
      return apiDbError(e instanceof Error ? e.message : String(e), "POST /api/invoices/[id]/sections");
    }
  },
);

interface PutBody {
  reorder: Array<{
    id: string;
    sort_order: number;
    parent_section_id: string | null;
  }>;
  updated_at_snapshot?: string;
}

export const PUT = withRequestContext(
  { permission: "edit_invoices" },
  async (request, { supabase }, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

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

      // Apply each reorder; trust caller-supplied parent_section_id (RLS guards cross-org)
      for (const r of body.reorder) {
        const { error } = await supabase
          .from("invoice_sections")
          .update({ sort_order: r.sort_order, parent_section_id: r.parent_section_id })
          .eq("id", r.id);
        if (error) throw error;
      }
      await touchEntity(supabase, "invoices", id);

      const { data: now } = await supabase.from("invoices").select("updated_at").eq("id", id).maybeSingle<{ updated_at: string }>();
      return NextResponse.json({ ok: true, updated_at: now?.updated_at });
    } catch (e: unknown) {
      return apiDbError(e instanceof Error ? e.message : String(e), "PUT /api/invoices/[id]/sections reorder");
    }
  },
);
