// POST /api/invoices/[id]/mark-sent
// Same DB effect as /send, but no email is sent. Used when the invoice was
// delivered outside the platform.
//
// Requires `edit_invoices` — a status transition (draft → sent), matching
// the sibling status mutations (PUT /status, /sections, /line-items).
// /send carries `manage_invoices` because it also sends email; mark-sent
// only flips the status, so it sits with the lighter edit gate.
// All reads/writes go through the Service client.

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import type { InvoiceRow } from "@/lib/invoices";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";

export const POST = withRequestContext(
  { serviceClient: true, permission: "edit_invoices" },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const service = ctx.serviceClient!;
    const { data: current } = await service
      .from("invoices")
      .select("status, deleted_at")
      .eq("id", id)
      .maybeSingle<{ status: string; deleted_at: string | null }>();
    if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
    const trashed = assertNotTrashed(current);
    if (trashed) return trashed;
    if (current.status !== "draft") {
      return NextResponse.json({ error: "only draft invoices can be marked sent" }, { status: 400 });
    }

    const { data: updated, error } = await service
      .from("invoices")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single<InvoiceRow>();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(updated);
  },
);
