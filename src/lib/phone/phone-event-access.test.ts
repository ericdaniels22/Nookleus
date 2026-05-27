// PRD #304 — Nookleus Phone. Slice 3 (#307).
//
// Pure unit tests for the manage-only branch of the access-decision module
// — the only branch slice 3 needs. Other branches (canRead / canSendFrom)
// land with slices 4+ when the read-path matrix lands. The module file
// exists now so future slices extend it; the AC bullet is:
//
//   "Vitest unit tests for `phone-event-access.canManage`
//    covering admin / non-admin / cross-org"
//
// Mirrors `email-account-access.test.ts` (#222) — the access matrix is the
// same shape (admin-only manage on Shared) so the test layout is too.

import { describe, it, expect } from "vitest";
import {
  canManage,
  type PhoneEventCaller,
  type PhoneNumberForManage,
} from "./phone-event-access";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const ALICE = "user-alice";
const BOB = "user-bob";

function caller(overrides: Partial<PhoneEventCaller> = {}): PhoneEventCaller {
  return {
    userId: ALICE,
    organizationId: ORG,
    role: "crew_lead",
    ...overrides,
  };
}

function shared(overrides: Partial<PhoneNumberForManage> = {}): PhoneNumberForManage {
  return {
    kind: "shared",
    organizationId: ORG,
    userId: null,
    ...overrides,
  };
}

function personal(
  owner: string,
  overrides: Partial<PhoneNumberForManage> = {},
): PhoneNumberForManage {
  return {
    kind: "personal",
    organizationId: ORG,
    userId: owner,
    ...overrides,
  };
}

describe("canManage (PRD #304, ADR 0003)", () => {
  describe("Shared number", () => {
    it("same-org admin: manage allowed", () => {
      expect(canManage(caller({ role: "admin" }), shared())).toBe(true);
    });

    it("same-org crew_lead: manage denied (admin-only)", () => {
      expect(canManage(caller({ role: "crew_lead" }), shared())).toBe(false);
    });

    it("same-org crew_member: manage denied", () => {
      expect(canManage(caller({ role: "crew_member" }), shared())).toBe(false);
    });

    it("cross-org admin: manage denied (org boundary holds before role check)", () => {
      expect(
        canManage(caller({ role: "admin", organizationId: OTHER_ORG }), shared()),
      ).toBe(false);
    });
  });

  describe("Personal number", () => {
    // Slice 13 introduces Personal-number management proper. The PRD locks
    // the access matrix in ADR 0003: admins manage Personal numbers for
    // offboarding (release), the owner manages their own.
    it("same-org admin can manage another user's Personal number (offboarding)", () => {
      expect(canManage(caller({ role: "admin" }), personal(BOB))).toBe(true);
    });

    it("owner can manage their own Personal number", () => {
      expect(
        canManage(caller({ role: "crew_lead", userId: ALICE }), personal(ALICE)),
      ).toBe(true);
    });

    it("non-owner non-admin cannot manage another's Personal number", () => {
      expect(canManage(caller({ role: "crew_lead" }), personal(BOB))).toBe(false);
    });

    it("cross-org admin cannot manage Personal numbers in another org", () => {
      expect(
        canManage(
          caller({ role: "admin", organizationId: OTHER_ORG }),
          personal(BOB),
        ),
      ).toBe(false);
    });

    it("a caller's userId matching the number's userId across orgs does NOT grant ownership", () => {
      // Owner-by-userId is meaningful only when the caller is in the
      // number's Organization. A stale `user_id` survival into another
      // org's number must not leak access.
      expect(
        canManage(
          caller({ role: "crew_lead", organizationId: OTHER_ORG, userId: ALICE }),
          personal(ALICE),
        ),
      ).toBe(false);
    });
  });

  describe("guard rails", () => {
    it("throws for an unknown number kind (never quietly returns false)", () => {
      const bogus = {
        kind: "service" as unknown as PhoneNumberForManage["kind"],
        organizationId: ORG,
        userId: null,
      };
      expect(() => canManage(caller({ role: "admin" }), bogus)).toThrow(
        /unknown phone number kind "service"/,
      );
    });
  });
});
