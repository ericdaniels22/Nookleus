// GET /api/invoices — list with filters (jobId, status, search, limit, offset).
//
// Direct invoice creation was retired in #386: an invoice now only comes into
// existence by converting an approved estimate (POST /api/estimates/[id]/convert).
// There is intentionally no POST handler here.

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import { escapeOrFilterValue } from "@/lib/postgrest";

export const GET = withRequestContext(
  { permission: "view_invoices" },
  async (request, { supabase, orgId }) => {
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");
    const status = url.searchParams.get("status");
    const search = url.searchParams.get("search")?.trim();
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);

    let q = supabase
      .from("invoices")
      .select(
        "*, jobs!inner(id, job_number, property_address, contact_id, contacts:contact_id(full_name))",
        { count: "exact" },
      )
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("issued_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (jobId) q = q.eq("job_id", jobId);
    if (status) q = q.eq("status", status);
    if (search) {
      const safe = escapeOrFilterValue(search);
      q = q.or(`invoice_number.ilike.%${safe}%,title.ilike.%${safe}%,memo.ilike.%${safe}%`);
    }

    try {
      const { data, error, count } = await q;
      if (error) throw error;
      return NextResponse.json({ rows: data ?? [], total: count ?? 0 });
    } catch (e: unknown) {
      return apiDbError(e instanceof Error ? e.message : String(e), "GET /api/invoices list");
    }
  },
);
