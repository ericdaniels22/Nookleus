import { describe, it, expect } from "vitest";
import {
  evaluatePermissionRule,
  type PermissionFacts,
} from "./evaluate-permission-rule";

// The four caller archetypes the acceptance criteria names, each crossed
// against every rule shape below.
const admin: PermissionFacts = { role: "admin", grantedPermissions: [] };
const adminWithGrants: PermissionFacts = {
  role: "admin",
  grantedPermissions: ["view_invoices"],
};
function member(grants: string[]): PermissionFacts {
  return { role: "member", grantedPermissions: grants };
}
const nonMember: PermissionFacts = { role: null, grantedPermissions: [] };

describe("evaluatePermissionRule", () => {
  describe("single-permission rule", () => {
    const rule = { permission: "view_invoices" };

    it("allows an admin even without the grant", () => {
      expect(evaluatePermissionRule(rule, admin)).toBe(true);
    });

    it("allows a non-admin who holds the grant", () => {
      expect(evaluatePermissionRule(rule, member(["view_invoices"]))).toBe(true);
    });

    it("denies a non-admin who lacks the grant", () => {
      expect(evaluatePermissionRule(rule, member(["view_estimates"]))).toBe(
        false,
      );
    });

    it("denies a non-member (no role, no grants)", () => {
      expect(evaluatePermissionRule(rule, nonMember)).toBe(false);
    });
  });

  describe("multi-permission rule", () => {
    const rule = { permission: ["view_estimates", "view_invoices"] };

    it("allows an admin even without any of the grants", () => {
      expect(evaluatePermissionRule(rule, admin)).toBe(true);
    });

    it("allows a non-admin who holds one of the keys", () => {
      expect(evaluatePermissionRule(rule, member(["view_invoices"]))).toBe(true);
    });

    it("allows a non-admin who holds the other key", () => {
      expect(evaluatePermissionRule(rule, member(["view_estimates"]))).toBe(
        true,
      );
    });

    it("denies a non-admin who holds none of the keys", () => {
      expect(evaluatePermissionRule(rule, member(["log_expenses"]))).toBe(
        false,
      );
    });

    it("denies a non-member", () => {
      expect(evaluatePermissionRule(rule, nonMember)).toBe(false);
    });
  });

  describe("adminOnly rule", () => {
    const rule = { adminOnly: true };

    it("allows an admin", () => {
      expect(evaluatePermissionRule(rule, admin)).toBe(true);
    });

    it("denies a non-admin even if they hold permission grants", () => {
      expect(
        evaluatePermissionRule(rule, member(["view_invoices", "log_expenses"])),
      ).toBe(false);
    });

    it("denies a non-member", () => {
      expect(evaluatePermissionRule(rule, nonMember)).toBe(false);
    });
  });

  describe("empty rule (logged-in only)", () => {
    const rule = {};

    it("allows an admin", () => {
      expect(evaluatePermissionRule(rule, admin)).toBe(true);
    });

    it("allows a non-admin with no grants", () => {
      expect(evaluatePermissionRule(rule, member([]))).toBe(true);
    });

    it("allows a caller with no membership in the active organization", () => {
      expect(evaluatePermissionRule(rule, nonMember)).toBe(true);
    });
  });

  describe("rule-shape edge cases", () => {
    it("enforces adminOnly when a rule mistakenly sets both adminOnly and permission", () => {
      const rule = { adminOnly: true, permission: "view_invoices" };
      expect(evaluatePermissionRule(rule, member(["view_invoices"]))).toBe(
        false,
      );
      expect(evaluatePermissionRule(rule, admin)).toBe(true);
    });

    it("denies a non-admin for an empty permission array, still admits an admin", () => {
      const rule = { permission: [] };
      expect(evaluatePermissionRule(rule, member(["view_invoices"]))).toBe(
        false,
      );
      expect(evaluatePermissionRule(rule, adminWithGrants)).toBe(true);
    });
  });
});
