// Issue #821 — the annotator's read-side helper for the org's Quick-pick
// labels. Wraps the settings GET (#819) so the Label editor can offer the
// org's saved phrases as tappable options. Degrades to an empty list on any
// failure so a labelling session never blocks on the catalogue being
// reachable; the free-text Label entry always remains available.

import type { QuickPickLabel } from "@/lib/types";

const QUICK_PICK_ENDPOINT = "/api/settings/quick-pick-labels";

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
