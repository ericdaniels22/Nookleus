import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Estimate,
  EstimateLineItem,
  EstimateSection,
  EstimateWithContents,
} from "@/lib/types";
import { round2 } from "@/lib/format";
import { touchEntity, checkSnapshot as checkSnapshotGeneric } from "@/lib/builder-shared";
import { computeWaterfall } from "@/lib/waterfall";

// Numbering note: the atomic per-job sequence lives in the SQL
// generate_estimate_number RPC, called inside create_estimate_with_template
// (#571) — there is no TS-side wrapper anymore.

// ─────────────────────────────────────────────────────────────────────────────
// Loaded fetch — returns estimate + sections (one level of nesting) + items
// ─────────────────────────────────────────────────────────────────────────────

export async function getEstimateWithContents(
  estimateId: string,
  supabase: SupabaseClient,
): Promise<EstimateWithContents | null> {
  const { data: estimate, error: estErr } = await supabase
    .from("estimates")
    .select("*")
    .eq("id", estimateId)
    .maybeSingle<Estimate>();
  if (estErr) throw new Error(`getEstimate failed: ${estErr.message}`);
  if (!estimate) return null;

  const { data: sections, error: secErr } = await supabase
    .from("estimate_sections")
    .select("*")
    .eq("estimate_id", estimateId)
    .order("sort_order", { ascending: true })
    .returns<EstimateSection[]>();
  if (secErr) throw new Error(`getSections failed: ${secErr.message}`);

  const { data: items, error: itemErr } = await supabase
    .from("estimate_line_items")
    .select("*")
    .eq("estimate_id", estimateId)
    .order("sort_order", { ascending: true })
    .returns<EstimateLineItem[]>();
  if (itemErr) throw new Error(`getLineItems failed: ${itemErr.message}`);

  const allSections = sections ?? [];
  const allItems = items ?? [];
  const topLevel = allSections.filter((s) => s.parent_section_id === null);
  const subsByParent = new Map<string, EstimateSection[]>();
  for (const s of allSections) {
    if (s.parent_section_id) {
      const arr = subsByParent.get(s.parent_section_id) ?? [];
      arr.push(s);
      subsByParent.set(s.parent_section_id, arr);
    }
  }
  const itemsBySection = new Map<string, EstimateLineItem[]>();
  for (const it of allItems) {
    const arr = itemsBySection.get(it.section_id) ?? [];
    arr.push(it);
    itemsBySection.set(it.section_id, arr);
  }

  return {
    ...estimate,
    sections: topLevel.map((sec) => ({
      ...sec,
      items: itemsBySection.get(sec.id) ?? [],
      subsections: (subsByParent.get(sec.id) ?? [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((sub) => ({
          ...sub,
          items: itemsBySection.get(sub.id) ?? [],
        })),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// recalculateTotals — server source of truth
// Called after every mutation that affects line items, markup, discount, or tax.
// Does NOT use a multi-statement transaction (Supabase JS limitation); the
// final UPDATE is the only writer of the cached values, and reads happen
// fresh in this function, so concurrent recalc calls converge.
// ─────────────────────────────────────────────────────────────────────────────

export async function recalculateTotals(
  estimateId: string,
  supabase: SupabaseClient,
): Promise<void> {
  // 1. Fetch line items
  const { data: items, error: itemErr } = await supabase
    .from("estimate_line_items")
    .select("id, quantity, unit_price, total")
    .eq("estimate_id", estimateId);
  if (itemErr) throw new Error(`recalc fetch items: ${itemErr.message}`);

  // 2. Defensive: write back any drifted line totals
  const lineUpdates: Array<{ id: string; total: number }> = [];
  for (const li of (items ?? []) as Array<{ id: string; quantity: number; unit_price: number; total: number }>) {
    const want = round2(Number(li.quantity) * Number(li.unit_price));
    if (want !== Number(li.total)) {
      lineUpdates.push({ id: li.id, total: want });
    }
  }
  if (lineUpdates.length > 0) {
    for (const u of lineUpdates) {
      const { error } = await supabase
        .from("estimate_line_items")
        .update({ total: u.total })
        .eq("id", u.id);
      if (error) throw new Error(`recalc write line: ${error.message}`);
    }
  }

  // 3. Load adjustment fields. The Markup is now the Overhead + Profit legs
  //    (#572); legacy markup_type/markup_value are write-dead and not read here.
  const { data: est, error: estErr } = await supabase
    .from("estimates")
    .select("overhead_type, overhead_value, profit_type, profit_value, discount_type, discount_value, tax_rate")
    .eq("id", estimateId)
    .maybeSingle<{
      overhead_type: "percent" | "amount" | "none";
      overhead_value: number;
      profit_type: "percent" | "amount" | "none";
      profit_value: number;
      discount_type: "percent" | "amount" | "none";
      discount_value: number;
      tax_rate: number;
    }>();
  if (estErr) throw new Error(`recalc fetch est: ${estErr.message}`);
  if (!est) throw new Error(`estimate ${estimateId} not found during recalc`);

  // 4. Compute authoritative per-line totals (same as the defensive write above)
  const lineItemTotals = ((items ?? []) as Array<{ quantity: number; unit_price: number }>)
    .map((li) => round2(Number(li.quantity) * Number(li.unit_price)));

  // 5. Delegate pure monetary calc to the shared waterfall
  const {
    subtotal,
    overhead_amount,
    profit_amount,
    markup_amount,
    discount_amount,
    adjusted_subtotal,
    tax_amount,
    total,
  } = computeWaterfall({
    lineItemCharges: lineItemTotals,
    overhead: { type: est.overhead_type, value: Number(est.overhead_value) },
    profit: { type: est.profit_type, value: Number(est.profit_value) },
    discount: { type: est.discount_type, value: Number(est.discount_value) },
    taxRatePercent: Number(est.tax_rate),
  });

  // 6. Write back. markup_amount is kept (= overhead_amount + profit_amount) so
  //    every existing reader of markup_amount stays correct.
  const { error: updErr } = await supabase
    .from("estimates")
    .update({
      subtotal,
      overhead_amount,
      profit_amount,
      markup_amount,
      discount_amount,
      adjusted_subtotal,
      tax_amount,
      total,
    })
    .eq("id", estimateId);
  if (updErr) throw new Error(`recalc write totals: ${updErr.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Concurrent-edit guard
// Returns 409 + fresh state if the parent estimate has been modified since the
// caller's snapshot. Used by the 4 PUT routes that auto-save mutates: the
// estimate-level fields PUT, line-item field PUT, and the two reorder PUTs.
// ─────────────────────────────────────────────────────────────────────────────

export type SnapshotCheckResult =
  | { ok: true; updated_at: string | null }
  | { ok: false; response: NextResponse };

export async function checkSnapshot(
  supabase: SupabaseClient,
  estimateId: string,
  snapshot: string | undefined,
): Promise<SnapshotCheckResult> {
  // When no snapshot is supplied the caller opts out of the guard — always allow,
  // even if the row has gone missing (mirrors original 67a behavior).
  const result = await checkSnapshotGeneric(supabase, "estimates", estimateId, snapshot);
  if (result.stale && snapshot) {
    const fresh = await getEstimateWithContents(estimateId, supabase);
    return {
      ok: false,
      response: NextResponse.json({ error: "stale", estimate: fresh }, { status: 409 }),
    };
  }
  return { ok: true, updated_at: result.current };
}

// Force-bump estimates.updated_at (used by the child-row reorder PUTs —
// /sections and /line-items — that don't otherwise touch the estimates row but
// must still mark it dirty for the snapshot guard).
//
// Why this matters (don't remove the touch): checkSnapshot above only fires when
// estimates.updated_at moves. A child write (reorder, line-item edit) that leaves
// the parent timestamp unchanged is invisible to it — two sessions editing
// different children would never collide and the second writer would silently
// clobber the first. So every child-only write force-bumps the parent here. The
// field-update route gets this for free via recalculateTotals (it writes the
// estimates row); reorders don't, which is exactly why touchEstimate exists. The
// invoice editor mirrors this same touch-on-child-write discipline.
//
// The BEFORE UPDATE trigger on estimates rewrites updated_at to now() so any
// UPDATE here works; we name updated_at explicitly for clarity.
export async function touchEstimate(
  supabase: SupabaseClient,
  estimateId: string,
): Promise<string | null> {
  await touchEntity(supabase, "estimates", estimateId);
  const { data } = await supabase
    .from("estimates")
    .select("updated_at")
    .eq("id", estimateId)
    .maybeSingle<{ updated_at: string }>();
  return data?.updated_at ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// One-level-only nesting validation
// ─────────────────────────────────────────────────────────────────────────────

export async function assertSectionDepth(
  parentSectionId: string,
  supabase: SupabaseClient,
): Promise<void> {
  const { data, error } = await supabase
    .from("estimate_sections")
    .select("parent_section_id")
    .eq("id", parentSectionId)
    .maybeSingle<{ parent_section_id: string | null }>();
  if (error) throw new Error(`assertSectionDepth: ${error.message}`);
  if (!data) throw new Error("parent section not found");
  if (data.parent_section_id !== null) {
    throw new Error("Sections cannot nest more than one level deep");
  }
}
