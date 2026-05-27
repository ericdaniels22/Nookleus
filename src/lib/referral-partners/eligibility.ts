// Picker eligibility for the Referrer field. ADR-0002.
//
// One pure function consumed by the `<ReferrerPicker>` component (Edit Job
// Info dialog + intake form) AND the server-side PATCH `/api/jobs/[id]`. A
// single source of truth means the dialog, the intake form, and the server
// cannot drift on what "an Active Referral Partner" means.

export type LifecycleStatus = "grey" | "yellow" | "green" | "red";

export type Eligibility = "pickable" | "promote-then-pick" | "hidden";

export interface EligibilityInput {
  status: LifecycleStatus;
  deleted_at: string | null;
}

export function eligibilityFor(partner: EligibilityInput): Eligibility {
  if (partner.deleted_at !== null) return "hidden";
  if (partner.status === "green") return "pickable";
  if (partner.status === "yellow") return "promote-then-pick";
  return "hidden";
}
