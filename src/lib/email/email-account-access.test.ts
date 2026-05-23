import { describe, it, expect } from "vitest";
import {
  canCreateEmailAccount,
  evaluateEmailAccountAccess,
  type EmailAccount,
  type EmailAccountCaller,
} from "./email-account-access";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const ALICE = "user-alice";
const BOB = "user-bob";

function caller(overrides: Partial<EmailAccountCaller> = {}): EmailAccountCaller {
  return {
    userId: ALICE,
    organizationId: ORG,
    role: "crew_lead",
    grantedPermissions: [],
    ...overrides,
  };
}

function shared(overrides: Partial<EmailAccount> = {}): EmailAccount {
  return {
    kind: "shared",
    organizationId: ORG,
    userId: null,
    ...overrides,
  };
}

function personal(owner: string, overrides: Partial<EmailAccount> = {}): EmailAccount {
  return {
    kind: "personal",
    organizationId: ORG,
    userId: owner,
    ...overrides,
  };
}

describe("evaluateEmailAccountAccess", () => {
  describe("shared account", () => {
    it("same-org admin: see + read + manage", () => {
      expect(
        evaluateEmailAccountAccess(caller({ role: "admin" }), shared()),
      ).toEqual({ canSee: true, canRead: true, canManage: true });
    });

    it("same-org non-admin with view_email: see + read, no manage", () => {
      expect(
        evaluateEmailAccountAccess(
          caller({ role: "crew_lead", grantedPermissions: ["view_email"] }),
          shared(),
        ),
      ).toEqual({ canSee: true, canRead: true, canManage: false });
    });

    it("same-org non-admin without view_email: all false", () => {
      expect(
        evaluateEmailAccountAccess(
          caller({ role: "crew_member", grantedPermissions: [] }),
          shared(),
        ),
      ).toEqual({ canSee: false, canRead: false, canManage: false });
    });

    it("cross-org admin with view_email: all false", () => {
      expect(
        evaluateEmailAccountAccess(
          caller({
            organizationId: OTHER_ORG,
            role: "admin",
            grantedPermissions: ["view_email"],
          }),
          shared(),
        ),
      ).toEqual({ canSee: false, canRead: false, canManage: false });
    });
  });

  describe("personal account owned by caller", () => {
    it("owner: see + read + manage (regardless of email perms)", () => {
      expect(
        evaluateEmailAccountAccess(
          caller({ role: "crew_lead", grantedPermissions: [] }),
          personal(ALICE),
        ),
      ).toEqual({ canSee: true, canRead: true, canManage: true });
    });
  });

  describe("personal account owned by someone else in same org", () => {
    it("same-org admin: see + manage, no read (content-private)", () => {
      expect(
        evaluateEmailAccountAccess(
          caller({ role: "admin" }),
          personal(BOB),
        ),
      ).toEqual({ canSee: true, canRead: false, canManage: true });
    });

    it("same-org non-admin with view_email: all false (Personal is owner-private)", () => {
      expect(
        evaluateEmailAccountAccess(
          caller({
            role: "crew_lead",
            grantedPermissions: ["view_email", "send_email"],
          }),
          personal(BOB),
        ),
      ).toEqual({ canSee: false, canRead: false, canManage: false });
    });

    it("same-org non-admin without perms: all false", () => {
      expect(
        evaluateEmailAccountAccess(
          caller({ role: "crew_member", grantedPermissions: [] }),
          personal(BOB),
        ),
      ).toEqual({ canSee: false, canRead: false, canManage: false });
    });
  });

  describe("account in another organization", () => {
    it("cross-org admin on a Personal account: all false", () => {
      expect(
        evaluateEmailAccountAccess(
          caller({
            organizationId: OTHER_ORG,
            role: "admin",
            grantedPermissions: ["view_email"],
          }),
          personal(BOB),
        ),
      ).toEqual({ canSee: false, canRead: false, canManage: false });
    });

    it("a caller's userId matching the account's userId across orgs does NOT grant ownership", () => {
      // Owner-by-userId is meaningful only when the caller is in the
      // account's Organization. A stale `user_id` survival into another
      // org's account must not leak access.
      expect(
        evaluateEmailAccountAccess(
          caller({ organizationId: OTHER_ORG, role: "crew_lead" }),
          personal(ALICE),
        ),
      ).toEqual({ canSee: false, canRead: false, canManage: false });
    });
  });

  describe("guard rails", () => {
    it("throws for an unknown account kind (never quietly returns all-false)", () => {
      const bogus = {
        kind: "service" as unknown as EmailAccount["kind"],
        organizationId: ORG,
        userId: null,
      };
      expect(() =>
        evaluateEmailAccountAccess(caller({ role: "admin" }), bogus),
      ).toThrow(/unknown email account kind "service"/);
    });
  });
});

describe("canCreateEmailAccount", () => {
  describe("shared account", () => {
    it("same-org admin with send_email: allowed", () => {
      expect(
        canCreateEmailAccount(
          caller({ role: "admin", grantedPermissions: ["send_email"] }),
          shared(),
        ),
      ).toBe(true);
    });

    it("same-org non-admin with send_email: denied (admin-only kind)", () => {
      expect(
        canCreateEmailAccount(
          caller({ role: "crew_lead", grantedPermissions: ["send_email"] }),
          shared(),
        ),
      ).toBe(false);
    });
  });

  describe("personal account", () => {
    it("same-org admin with send_email creates Personal owned by self: allowed", () => {
      expect(
        canCreateEmailAccount(
          caller({ role: "admin", grantedPermissions: ["send_email"] }),
          personal(ALICE),
        ),
      ).toBe(true);
    });

    it("same-org admin with send_email creates Personal owned by another user: allowed", () => {
      expect(
        canCreateEmailAccount(
          caller({ role: "admin", grantedPermissions: ["send_email"] }),
          personal(BOB),
        ),
      ).toBe(true);
    });

    it("same-org non-admin with send_email creates Personal owned by self: allowed", () => {
      expect(
        canCreateEmailAccount(
          caller({ role: "crew_lead", grantedPermissions: ["send_email"] }),
          personal(ALICE),
        ),
      ).toBe(true);
    });

    it("same-org non-admin with send_email creates Personal owned by another user: denied", () => {
      expect(
        canCreateEmailAccount(
          caller({ role: "crew_lead", grantedPermissions: ["send_email"] }),
          personal(BOB),
        ),
      ).toBe(false);
    });
  });

  describe("belt-and-suspenders send_email re-check", () => {
    // The route wrapper already gates send_email. The function re-checks
    // defensively — if a future caller wires the function in without the
    // wrapper, the answer must still be no.
    it("admin without send_email creating Shared: denied", () => {
      expect(
        canCreateEmailAccount(
          caller({ role: "admin", grantedPermissions: [] }),
          shared(),
        ),
      ).toBe(false);
    });

    it("admin without send_email creating Personal-as-self: denied", () => {
      expect(
        canCreateEmailAccount(
          caller({ role: "admin", grantedPermissions: [] }),
          personal(ALICE),
        ),
      ).toBe(false);
    });

    it("non-admin without send_email creating Personal-as-self: denied", () => {
      expect(
        canCreateEmailAccount(
          caller({ role: "crew_lead", grantedPermissions: [] }),
          personal(ALICE),
        ),
      ).toBe(false);
    });
  });

  describe("cross-Organization caller", () => {
    it("admin in another org with send_email creating Shared in the target org: denied", () => {
      expect(
        canCreateEmailAccount(
          caller({
            organizationId: OTHER_ORG,
            role: "admin",
            grantedPermissions: ["send_email"],
          }),
          shared(),
        ),
      ).toBe(false);
    });

    it("admin in another org with send_email creating Personal-as-self in the target org: denied", () => {
      expect(
        canCreateEmailAccount(
          caller({
            organizationId: OTHER_ORG,
            role: "admin",
            grantedPermissions: ["send_email"],
          }),
          personal(ALICE),
        ),
      ).toBe(false);
    });
  });

  describe("guard rails", () => {
    it("throws for an unknown account kind (never quietly returns false)", () => {
      const bogus = {
        kind: "service" as unknown as EmailAccount["kind"],
        organizationId: ORG,
        userId: null,
      };
      expect(() =>
        canCreateEmailAccount(
          caller({ role: "admin", grantedPermissions: ["send_email"] }),
          bogus,
        ),
      ).toThrow(/unknown email account kind "service"/);
    });
  });
});
