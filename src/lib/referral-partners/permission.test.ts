import { describe, expect, it } from "vitest";

import { evaluatePermissionRule } from "@/lib/request-context/evaluate-permission-rule";
import {
  EDIT_REFERRAL_PARTNERS,
  VIEW_REFERRAL_PARTNERS,
} from "./permission";

function facts(role: string | null) {
  return { role, grantedPermissions: [] };
}

describe("VIEW_REFERRAL_PARTNERS / EDIT_REFERRAL_PARTNERS", () => {
  it("admin passes both rules — admins can do anything anyone else can on this surface", () => {
    expect(evaluatePermissionRule(VIEW_REFERRAL_PARTNERS, facts("admin"))).toBe(true);
    expect(evaluatePermissionRule(EDIT_REFERRAL_PARTNERS, facts("admin"))).toBe(true);
  });

  it("crew_lead passes both rules — leads run the cold-call program", () => {
    expect(evaluatePermissionRule(VIEW_REFERRAL_PARTNERS, facts("crew_lead"))).toBe(true);
    expect(evaluatePermissionRule(EDIT_REFERRAL_PARTNERS, facts("crew_lead"))).toBe(true);
  });

  it("crew_member is denied — fee terms and decline reasons aren't theirs to see", () => {
    expect(evaluatePermissionRule(VIEW_REFERRAL_PARTNERS, facts("crew_member"))).toBe(false);
    expect(evaluatePermissionRule(EDIT_REFERRAL_PARTNERS, facts("crew_member"))).toBe(false);
  });

  it("a caller with no membership in the active organization is denied", () => {
    expect(evaluatePermissionRule(VIEW_REFERRAL_PARTNERS, facts(null))).toBe(false);
    expect(evaluatePermissionRule(EDIT_REFERRAL_PARTNERS, facts(null))).toBe(false);
  });
});
