// Permission rules for the Referral Partners surface (PRD #249, issue #250).
//
// `admin` and `crew_lead` memberships can view AND edit Referral Partners.
// `crew_member` cannot see the surface at all. Splitting view and edit into
// two named rules keeps room to diverge later (e.g. a future read-only role
// for an outside-sales contractor) without rewriting every call site.

import type { RequestContextRule } from "@/lib/request-context/with-request-context";

const REFERRAL_PARTNER_ROLES = ["admin", "crew_lead"] as const;

/** Used by the nav-visibility check, the list route, and the Worksheet route. */
export const VIEW_REFERRAL_PARTNERS: RequestContextRule = {
  roles: [...REFERRAL_PARTNER_ROLES],
};

/** Used by every mutation endpoint that creates, updates, or deletes
 *  Referral Partners or Call log entries. */
export const EDIT_REFERRAL_PARTNERS: RequestContextRule = {
  roles: [...REFERRAL_PARTNER_ROLES],
};
