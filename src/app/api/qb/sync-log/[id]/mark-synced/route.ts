// POST /api/qb/sync-log/[id]/mark-synced
// Manual override: admin provides a QB entity id (or leaves blank) and the
// log row flips to synced with note "manually_marked". Used when the record
// was created in QB out-of-band or when a stuck row needs to move on.

import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";
import type { QbSyncLogRow } from "@/lib/qb/types";

async function postMarkSynced(
  request: Request,
  ctx: RequestContext,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { qbEntityId?: string };
  const qbEntityId =
    typeof body.qbEntityId === "string" && body.qbEntityId.trim()
      ? body.qbEntityId.trim()
      : null;

  const service = ctx.serviceClient!;
  const { data: row } = await service
    .from("qb_sync_log")
    .select("*")
    .eq("id", id)
    .maybeSingle<QbSyncLogRow>();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Write qb_*_id back to the platform record when the user provides one.
  if (qbEntityId) {
    if (row.entity_type === "customer") {
      await service.from("contacts").update({ qb_customer_id: qbEntityId }).eq("id", row.entity_id);
    } else if (row.entity_type === "sub_customer") {
      await service.from("jobs").update({ qb_subcustomer_id: qbEntityId }).eq("id", row.entity_id);
    } else if (row.entity_type === "invoice") {
      await service.from("invoices").update({ qb_invoice_id: qbEntityId }).eq("id", row.entity_id);
    } else if (row.entity_type === "payment") {
      await service.from("payments").update({ qb_payment_id: qbEntityId }).eq("id", row.entity_id);
    }
  }

  const { error } = await service
    .from("qb_sync_log")
    .update({
      status: "synced",
      qb_entity_id: qbEntityId ?? row.qb_entity_id,
      error_message: "manually_marked",
      error_code: null,
      synced_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export const POST = withRequestContext(
  { adminOnly: true, serviceClient: true },
  postMarkSynced,
);
