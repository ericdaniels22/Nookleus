// POST /api/invoices/[id]/void
// Guards against payments on the invoice. Sets status=voided, voided_at, voided_by.
// Trigger handles QB enqueue (and coalesces with queued create if applicable).

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import type { InvoiceRow } from "@/lib/invoices";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const service = createServiceClient();
  const { data: current } = await service
    .from("invoices")
    .select("status, deleted_at")
    .eq("id", id)
    .maybeSingle<{ status: string; deleted_at: string | null }>();
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
  const trashed = assertNotTrashed(current);
  if (trashed) return trashed;
  if (current.status === "voided") {
    return NextResponse.json({ error: "already voided" }, { status: 400 });
  }
  if (current.status === "draft") {
    return NextResponse.json(
      { error: "drafts can be deleted instead of voided" },
      { status: 400 },
    );
  }

  const { count } = await service
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", id);
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "Cannot void an invoice with recorded payments. Refund or void payments first.",
      },
      { status: 400 },
    );
  }

  const { data: updated, error } = await service
    .from("invoices")
    .update({
      status: "voided",
      voided_at: new Date().toISOString(),
      voided_by: user.id,
    })
    .eq("id", id)
    .select()
    .single<InvoiceRow>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(updated);
}
