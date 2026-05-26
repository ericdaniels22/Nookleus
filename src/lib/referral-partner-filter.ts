// Pure filter logic for the Referral Partners list page (PRD #249, issue #251).
//
// The list page asks three questions of every partner — does its Lifecycle
// status pass the chip filter? does its industry match the dropdown? does
// its company name contain the search query? — and this module owns the
// rule. No I/O, no React; testable in isolation. Modelled after
// `src/lib/insurance-picker.ts`.

export type LifecycleStatus = "grey" | "yellow" | "green" | "red";

/** The subset of a Referral Partner row this module reads. Callers may pass
 *  richer objects; the filter ignores everything else. */
export interface FilterableReferralPartner {
  id: string;
  company_name: string;
  status: LifecycleStatus;
  industry: string | null;
}

export interface ReferralPartnerFilter {
  /** Lifecycle statuses to include. Omitted (or undefined) means every
   *  status passes — matches the list page's default of all chips on. */
  status?: ReadonlyArray<LifecycleStatus>;
  /** A single industry to narrow to. Omitted or empty string means every
   *  industry passes. */
  industry?: string;
  /** Case-insensitive substring match against `company_name`. Omitted,
   *  empty, or whitespace-only means every name passes. */
  query?: string;
}

/**
 * The set of industry values that appear on at least one partner, with
 * nulls dropped and duplicates collapsed. Sorted alphabetically so the
 * dropdown is stable across renders regardless of insert order.
 */
export function distinctIndustries(
  partners: ReadonlyArray<FilterableReferralPartner>,
): string[] {
  const seen = new Set<string>();
  for (const p of partners) {
    if (p.industry) seen.add(p.industry);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

export function filterReferralPartners<T extends FilterableReferralPartner>(
  partners: ReadonlyArray<T>,
  filter: ReferralPartnerFilter,
): T[] {
  const statusSet = filter.status ? new Set(filter.status) : null;
  const industry = filter.industry?.trim() ?? "";
  const query = filter.query?.trim().toLowerCase() ?? "";
  return partners.filter((p) => {
    if (statusSet && !statusSet.has(p.status)) return false;
    if (industry && p.industry !== industry) return false;
    if (query && !p.company_name.toLowerCase().includes(query)) return false;
    return true;
  });
}
