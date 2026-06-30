// Issue #821 — the annotator's read-side helper for the org's Quick-pick
// labels. Wraps the settings GET (#819) so the Label editor can offer the
// org's saved phrases as tappable options. Degrades to an empty list on any
// failure so a labelling session never blocks on the catalogue being
// reachable; the free-text Label entry always remains available.

import type { QuickPickLabel } from "@/lib/types";

const QUICK_PICK_ENDPOINT = "/api/settings/quick-pick-labels";

/** True for a shared NULL-org default — visible to every org, owned by none. */
export function isDefaultLabel(ql: QuickPickLabel): boolean {
  return ql.organization_id === null;
}

/**
 * Build the bulk-reorder payload for the org's own labels (#856). Defaults are
 * immovable: they keep their sort positions and are excluded from the payload
 * (the org-scoped write can't persist them anyway). Each org row, in its given
 * display order, is assigned a `sort_order` strictly greater than every
 * default's — so the persisted order never collides with a default and is
 * deterministic across refreshes and repeated reorders.
 */
export function buildReorderPayload(
  labels: QuickPickLabel[]
): { id: string; label: string; sort_order: number }[] {
  const maxDefault = labels.reduce(
    (max, ql) => (isDefaultLabel(ql) ? Math.max(max, ql.sort_order) : max),
    0
  );
  return labels
    .filter((ql) => !isDefaultLabel(ql))
    .map((ql, i) => ({ id: ql.id, label: ql.label, sort_order: maxDefault + i + 1 }));
}

/**
 * Reorder the org's own labels by moving the org row at `orgIndex` (its
 * position among the org rows, not the full list) one slot in `direction`.
 * Defaults are never part of the swap and stay pinned at the top in their
 * original order. A move that would cross the default boundary or run off the
 * end is a no-op — the input order is returned unchanged.
 */
export function moveOrgLabel(
  labels: QuickPickLabel[],
  orgIndex: number,
  direction: "up" | "down"
): QuickPickLabel[] {
  const defaults = labels.filter(isDefaultLabel);
  const orgRows = labels.filter((ql) => !isDefaultLabel(ql));
  const target = direction === "up" ? orgIndex - 1 : orgIndex + 1;
  if (orgIndex < 0 || target < 0 || target >= orgRows.length) {
    return [...defaults, ...orgRows];
  }
  [orgRows[orgIndex], orgRows[target]] = [orgRows[target], orgRows[orgIndex]];
  return [...defaults, ...orgRows];
}

/**
 * Fetch the org's Quick-pick labels (its own rows plus the shared NULL-org
 * defaults), already ordered by `sort_order` server-side. Returns them in that
 * order, or an empty list if the request fails, errors, or returns a non-array
 * body — never throws, so the annotator's Label editor can render with no
 * options rather than surfacing a blocking error.
 */
export async function loadQuickPickLabels(
  fetchImpl: typeof fetch = fetch
): Promise<QuickPickLabel[]> {
  try {
    const res = await fetchImpl(QUICK_PICK_ENDPOINT);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as QuickPickLabel[]) : [];
  } catch {
    return [];
  }
}
