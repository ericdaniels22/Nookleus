// PUT /api/invoices/[id]/status — state-machine transitions
// Allowed per spec §9.1:
//   draft   → sent | voided
//   sent    → partial | paid | voided
//   partial → paid | voided
//   paid    → sent      (undo accidental mark-paid)
//   voided  → (terminal)

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";
import { checkSnapshot } from "@/lib/builder-shared";

type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "voided";

const VALID_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft:   ["sent", "voided"],
  sent:    ["partial", "paid", "voided"],
  partial: ["paid", "voided"],
  paid:    ["sent"],
  voided:  [],
};

interface PutBody {
  status: InvoiceStatus;
  amount?: number; // for partial → paid; ignored otherwise
  reason?: string; // for void
  updated_at_snapshot?: string;
}

export const PUT = withRequestContext(
  { permission: "edit_invoices" },
  async (request, { supabase }, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as PutBody | null;
    if (!body || typeof body.status !== "string") {
      return NextResponse.json({ error: "status required" }, { status: 400 });
    }

    try {
      const { stale, current } = await checkSnapshot(supabase, "invoices", id, body.updated_at_snapshot);
      if (stale) {
        return NextResponse.json(
          { error: "stale_snapshot", current_updated_at: current },
          { status: current === null ? 404 : 409 },
        );
      }

      const { data: cur } = await supabase
        .from("invoices").select("status, deleted_at").eq("id", id).maybeSingle<{ status: InvoiceStatus; deleted_at: string | null }>();
      if (!cur) return NextResponse.json({ error: "not_found" }, { status: 404 });
      const trashed = assertNotTrashed(cur);
      if (trashed) return trashed;
      const next = body.status;
      if (!VALID_TRANSITIONS[cur.status].includes(next)) {
        return NextResponse.json(
          { error: "invalid_transition", from: cur.status, to: next },
          { status: 400 },
        );
      }

      const patch: Record<string, unknown> = { status: next, updated_at: new Date().toISOString() };
      // Only set sent_at on the first send (draft → sent), not on paid → sent un-marks
      if (next === "sent" && cur.status === "draft") patch.sent_at = new Date().toISOString();
      if (next === "voided") {
        patch.voided_at = new Date().toISOString();
        patch.void_reason = body.reason ?? null;
      }

      const { data, error } = await supabase.from("invoices").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return NextResponse.json(data);
    } catch (e: unknown) {
      return apiDbError(e instanceof Error ? e.message : String(e), "PUT /api/invoices/[id]/status");
    }
  },
);
