import { describe, it, expect } from "vitest";
import {
  evaluatePermissionRule,
  type PermissionFacts,
  type PermissionRule,
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
    const rule: PermissionRule = { permission: "view_invoices" };

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
    const rule: PermissionRule = {
      permission: ["view_estimates", "view_invoices"],
    };

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

  describe("roles rule", () => {
    // The job-delete gate: admin OR office_staff, no permission grant
    // substitutes.
    const rule = { roles: ["admin", "office_staff"] };

    it("allows an admin (admin is listed explicitly)", () => {
      expect(evaluatePermissionRule(rule, admin)).toBe(true);
    });

    it("allows a non-admin whose role is in the list", () => {
      expect(
        evaluatePermissionRule(rule, { role: "office_staff", grantedPermissions: [] }),
      ).toBe(true);
    });

    it("denies a role not in the list, even with permission grants", () => {
      expect(
        evaluatePermissionRule(rule, member(["view_invoices", "log_expenses"])),
      ).toBe(false);
    });

    it("denies a non-member (null role)", () => {
      expect(evaluatePermissionRule(rule, nonMember)).toBe(false);
    });

    it("does not auto-pass an admin when admin is absent from the list", () => {
      expect(evaluatePermissionRule({ roles: ["office_staff"] }, admin)).toBe(
        false,
      );
    });
  });

  describe("rule-shape edge cases", () => {
    it("enforces adminOnly when a rule mistakenly sets both adminOnly and permission", () => {
      const rule: PermissionRule = {
        adminOnly: true,
        permission: "view_invoices",
      };
      expect(evaluatePermissionRule(rule, member(["view_invoices"]))).toBe(
        false,
      );
      expect(evaluatePermissionRule(rule, admin)).toBe(true);
    });

    it("denies a non-member for an empty roles list", () => {
      expect(evaluatePermissionRule({ roles: [] }, admin)).toBe(false);
      expect(evaluatePermissionRule({ roles: [] }, nonMember)).toBe(false);
    });

    it("denies a non-admin for an empty permission array, still admits an admin", () => {
      const rule: PermissionRule = { permission: [] };
      expect(evaluatePermissionRule(rule, member(["view_invoices"]))).toBe(
        false,
      );
      expect(evaluatePermissionRule(rule, adminWithGrants)).toBe(true);
    });
  });
});
