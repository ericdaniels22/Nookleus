// PATCH  /api/payments/[id]   — edit. Trigger handles QB update enqueue.
// DELETE /api/payments/[id]   — delete. Trigger captures snapshot before delete.

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

interface PatchBody {
  amount?: number;
  method?: string;
  source?: string;
  receivedDate?: string | null;
  referenceNumber?: string | null;
  payerName?: string | null;
  notes?: string | null;
  status?: "received" | "pending" | "due";
}

export const PATCH = withRequestContext(
  { permission: "record_payments", serviceClient: true },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as PatchBody | null;
    if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

    const patch: Record<string, unknown> = {};
    if (typeof body.amount === "number") patch.amount = body.amount;
    if (typeof body.method === "string") patch.method = body.method;
    if (typeof body.source === "string") patch.source = body.source;
    if (body.receivedDate !== undefined) patch.received_date = body.receivedDate;
    if (body.referenceNumber !== undefined) patch.reference_number = body.referenceNumber;
    if (body.payerName !== undefined) patch.payer_name = body.payerName;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.status) patch.status = body.status;

    const { data, error } = await ctx.serviceClient!
      .from("payments")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  },
);

export const DELETE = withRequestContext(
  { permission: "record_payments", serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const { error } = await ctx.serviceClient!.from("payments").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  },
);
