// POST /api/invoices/[id]/mark-sent
// Same DB effect as /send, but no email is sent. Used when the invoice was
// delivered outside the platform.

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
}
