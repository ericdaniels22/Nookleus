import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { syncPaymentToQb } from "@/lib/qb/sync/stripe-payment-bridge";

export const runtime = "nodejs";

export const POST = withRequestContext(
  { permission: "record_payments", serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const supabase = ctx.serviceClient!;

    // Mark pending before attempting, so the UI badge flips quickly.
    await supabase
      .from("payments")
      .update({
        quickbooks_sync_status: "pending",
        quickbooks_sync_attempted_at: new Date().toISOString(),
        quickbooks_sync_error: null,
      })
      .eq("id", id);

    try {
      await syncPaymentToQb(id);
      return NextResponse.json({ ok: true, status: "synced" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase
        .from("payments")
        .update({
          quickbooks_sync_status: "failed",
          quickbooks_sync_error: msg,
          quickbooks_sync_attempted_at: new Date().toISOString(),
        })
        .eq("id", id);
      return NextResponse.json({ error: msg, status: "failed" }, { status: 500 });
    }
  },
);
