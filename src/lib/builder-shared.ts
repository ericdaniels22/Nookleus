// Cross-entity helpers shared by estimates and invoices.
// Templates skip touchEntity / checkSnapshot — they have no totals to recalc
// and no realistic multi-editor concurrency case.

import type { SupabaseClient } from "@supabase/supabase-js";

export type EntityTable = "estimates" | "invoices";

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

// The pricing-waterfall calc that used to live here (recalculateMonetary) is
// now computeWaterfall in @/lib/waterfall — shared with the client builder.

/** Bumps `updated_at` on a parent estimate or invoice. Used after child-table writes
 *  so the next snapshot read sees the change (lesson from 67a I2 closure). */
export async function touchEntity(
  supabase: SupabaseClient,
  table: EntityTable,
  id: string,
): Promise<void> {
  const { error } = await supabase.from(table).update({ updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export interface SnapshotCheck {
  stale: boolean;
  current: string | null;
}

/** Reads the current `updated_at` of a row and compares against caller's snapshot.
 *  Returns { stale: true } if the row has been updated since the snapshot was taken,
 *  or if the row no longer exists (treat-as-stale per 67a I3 behavior). */
export async function checkSnapshot(
  supabase: SupabaseClient,
  table: EntityTable,
  id: string,
  snapshot: string | null | undefined,
): Promise<SnapshotCheck> {
  const { data, error } = await supabase
    .from(table)
    .select("updated_at")
    .eq("id", id)
    .maybeSingle<{ updated_at: string }>();
  if (error) throw error;
  if (!data) return { stale: true, current: null }; // 404 → treat as stale
  if (!snapshot) return { stale: false, current: data.updated_at }; // no snapshot supplied → always allow
  return { stale: data.updated_at !== snapshot, current: data.updated_at };
}
