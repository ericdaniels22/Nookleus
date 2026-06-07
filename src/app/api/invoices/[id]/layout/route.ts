import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";
import { isLayoutLocked, parseLayoutPayload } from "@/lib/pdf-layout";

// PATCH /api/invoices/[id]/layout — persist a document's own PDF layout snapshot
// (ADR 0012, #485). The invoice twin of /api/estimates/[id]/layout: the panel
// sends a complete DocumentPdfLayout (the effective look with switches flipped);
// this route writes it to the invoice's `pdf_layout` JSONB column.
export const PATCH = withRequestContext(
  { permission: "edit_invoices" },
  async (request, { supabase }, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);

    // The panel always sends a complete DocumentPdfLayout (the effective look
    // with switches flipped). Reject anything that is not the canonical shape so
    // only a well-formed snapshot reaches the JSONB column.
    const layout = parseLayoutPayload(body);
    if (!layout) {
      return NextResponse.json({ error: "invalid_layout" }, { status: 400 });
    }

    const { data: cur } = await supabase
      .from("invoices")
      .select("status, deleted_at")
      .eq("id", id)
      .maybeSingle<{ status: string; deleted_at: string | null }>();

    // The document must exist and be live (not soft-deleted) — 404 otherwise.
    const trashed = assertNotTrashed(cur);
    if (trashed) return trashed;

    // A frozen invoice (paid or voided, ADR 0007/0012) can no longer change its
    // look. Refuse with 409 — the request conflicts with state.
    if (cur && isLayoutLocked("invoice", cur.status)) {
      return NextResponse.json({ error: "layout_locked" }, { status: 409 });
    }

    const { error } = await supabase
      .from("invoices")
      .update({ pdf_layout: layout })
      .eq("id", id);
    if (error) {
      return apiDbError(error.message, "PATCH /api/invoices/[id]/layout");
    }
    return NextResponse.json({ pdf_layout: layout });
  },
);
