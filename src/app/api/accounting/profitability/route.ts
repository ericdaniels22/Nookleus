// src/app/api/accounting/profitability/route.ts
import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";
import { aggregateMargins, marginPctBand, type MarginFilter } from "@/lib/accounting/margins";
import { resolveRange, type RangePreset } from "@/lib/accounting/date-ranges";

async function getProfitability(request: Request, ctx: RequestContext) {
  const url = new URL(request.url);
  const preset = (url.searchParams.get("range") ?? "last_30") as RangePreset;
  const filter = (url.searchParams.get("filter") ?? "all") as MarginFilter;
  const sort = url.searchParams.get("sort") ?? "margin_desc";
  const range = resolveRange(preset);

  const supabase = ctx.supabase;
  const margins = await aggregateMargins(range.startISO, range.endISO, filter);

  // Attach job context (address, damage type, customer name).
  const jobIds = margins.map((m) => m.jobId);
  const { data: jobs } = jobIds.length
    ? await supabase.from("jobs").select("id, damage_type, property_address, contact_id").in("id", jobIds)
    : { data: [] };
  const contactIds = (jobs ?? []).map((j) => j.contact_id).filter((id): id is string => !!id);
  const { data: contacts } = contactIds.length
    ? await supabase.from("contacts").select("id, first_name, last_name").in("id", contactIds)
    : { data: [] };

  const jobById = new Map((jobs ?? []).map((j) => [j.id, j]));
  const contactById = new Map((contacts ?? []).map((c) => [c.id, c]));

  const rows = margins.map((m) => {
    const j = jobById.get(m.jobId);
    const c = j?.contact_id ? contactById.get(j.contact_id) : null;
    const customer_name = c ? `${c.first_name} ${c.last_name}`.trim() : null;
    return {
      ...m,
      damage_type: j?.damage_type ?? null,
      property_address: j?.property_address ?? null,
      customer_name,
      margin_band: marginPctBand(m.margin_pct),
    };
  });

  const cmp: Record<string, (a: typeof rows[number], b: typeof rows[number]) => number> = {
    margin_desc: (a, b) => b.gross_margin - a.gross_margin,
    margin_pct_desc: (a, b) => (b.margin_pct ?? -Infinity) - (a.margin_pct ?? -Infinity),
    revenue_desc: (a, b) => b.collected - a.collected,
    expenses_desc: (a, b) => b.expenses - a.expenses,
    recent: () => 0, // no timestamp attached; sorted by DB order (recent-first by created_at)
  };
  rows.sort(cmp[sort] ?? cmp.margin_desc);

  return NextResponse.json({ rows, range: { preset: range.preset, label: range.label } });
}

export const GET = withRequestContext(
  { permission: "view_accounting" },
  getProfitability,
);
