// `<ReferrerPicker>` — picker for the Job's Referral Partner attribution
// (issue #298, ADR-0002). Used in the Edit Job Info dialog now and the
// intake form in slice D. Both surfaces delegate to `eligibilityFor()` so
// the picker offers the same "Active Referral Partners only" shape with
// the same `+ Promote and attach` affordance for yellow Targets.
//
// The component takes the full partner list and groups it client-side
// (the caller passes every non-trashed row; pre-filtering on the caller's
// side would prevent yellow Targets from appearing under Promote-and-attach).
// Trashed rows are tolerated and hidden — callers don't have to pre-filter.

"use client";

import { eligibilityFor } from "@/lib/referral-partners/eligibility";
import type { LifecycleStatus } from "@/lib/referral-partners/eligibility";

export interface ReferrerPickerPartner {
  id: string;
  company_name: string;
  status: LifecycleStatus;
  deleted_at: string | null;
}

export interface ReferrerPickerProps {
  partners: ReferrerPickerPartner[];
  value: string | null;
  onChange: (id: string | null) => void;
  onPromoteAndPick: (id: string) => void;
}

export default function ReferrerPicker({
  partners,
  value,
  onChange,
  onPromoteAndPick,
}: ReferrerPickerProps) {
  const pickable = partners.filter(
    (p) => eligibilityFor(p) === "pickable",
  );
  const promotable = partners.filter(
    (p) => eligibilityFor(p) === "promote-then-pick",
  );

  return (
    <div>
      <ul>
        {pickable.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onChange(p.id)}>
              {p.company_name}
            </button>
          </li>
        ))}
      </ul>

      {promotable.length > 0 && (
        <div>
          <div>+ Promote and attach</div>
          <ul>
            {promotable.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onPromoteAndPick(p.id)}>
                  {p.company_name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {value !== null && (
        <button type="button" onClick={() => onChange(null)}>
          Clear
        </button>
      )}
    </div>
  );
}
