import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";
import { checkSnapshot } from "@/lib/builder-shared";
import { canTransitionEstimate } from "@/lib/estimate-status";
import type { EstimateStatus } from "@/lib/types";

interface PutBody {
  status: EstimateStatus;
  reason?: string;
  updated_at_snapshot?: string;
}

export const PUT = withRequestContext(
  { permission: "edit_estimates" },
  async (request, { supabase }, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as PutBody | null;
    if (!body || typeof body.status !== "string") {
      return NextResponse.json({ error: "status required" }, { status: 400 });
    }

    try {
      const { stale, current } = await checkSnapshot(supabase, "estimates", id, body.updated_at_snapshot);
      if (stale) {
        return NextResponse.json(
          { error: "stale_snapshot", current_updated_at: current },
          { status: current === null ? 404 : 409 },
        );
      }

      const { data: cur } = await supabase
        .from("estimates").select("status, converted_to_invoice_id, deleted_at").eq("id", id).maybeSingle<{ status: EstimateStatus; converted_to_invoice_id: string | null; deleted_at: string | null }>();
      if (!cur) return NextResponse.json({ error: "not_found" }, { status: 404 });
      const trashed = assertNotTrashed(cur);
      if (trashed) return trashed;

      // Spec rule: cannot void a converted estimate
      if (body.status === "voided" && cur.converted_to_invoice_id !== null) {
        return NextResponse.json(
          { error: "cannot_void_converted", linked_invoice_id: cur.converted_to_invoice_id },
          { status: 400 },
        );
      }

      if (!canTransitionEstimate(cur.status, body.status)) {
        return NextResponse.json(
          { error: "invalid_transition", from: cur.status, to: body.status },
          { status: 400 },
        );
      }

      const patch: Record<string, unknown> = { status: body.status, updated_at: new Date().toISOString() };
      if (body.status === "sent") patch.sent_at = new Date().toISOString();
      if (body.status === "voided") {
        patch.voided_at = new Date().toISOString();
        patch.void_reason = body.reason ?? null;
      }

      const { data, error } = await supabase.from("estimates").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return NextResponse.json(data);
    } catch (e: unknown) {
      return apiDbError(e instanceof Error ? e.message : String(e), "PUT /api/estimates/[id]/status");
    }
  },
);
