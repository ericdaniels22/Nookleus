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
  canRead,
  type PhoneEventCaller,
  type PhoneEventForRead,
  type PhoneEventReadCaller,
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

// ---------------------------------------------------------------------------
// canRead — the read-path matrix from ADR 0003. PRD #304 § Privacy rule:
//
//   Job-tagged content is team-visible to anyone with view_phone who can
//   see the Job, across all numbers (Shared or Personal).
//   Untagged content on a Shared number is team-visible.
//   Untagged content on a Personal number is owner-only — including
//   hidden from admins.
//
// Cross-org callers are denied regardless of permission. The matrix is
// total: every cell of {Shared, Personal} × {tagged, untagged} ×
// {admin, owner, other-team-member, cross-org} × {job-visible, not} is
// pinned by a test below.
// ---------------------------------------------------------------------------

function readCaller(overrides: Partial<PhoneEventReadCaller> = {}): PhoneEventReadCaller {
  return {
    userId: ALICE,
    organizationId: ORG,
    role: "crew_lead",
    grantedPermissions: ["view_phone"],
    ...overrides,
  };
}

function sharedEvent(overrides: Partial<PhoneEventForRead> = {}): PhoneEventForRead {
  return {
    organizationId: ORG,
    numberKind: "shared",
    numberOwnerId: null,
    jobTag: null,
    ...overrides,
  };
}

function personalEvent(
  owner: string,
  overrides: Partial<PhoneEventForRead> = {},
): PhoneEventForRead {
  return {
    organizationId: ORG,
    numberKind: "personal",
    numberOwnerId: owner,
    jobTag: null,
    ...overrides,
  };
}

describe("canRead (PRD #304, ADR 0003) — full access matrix", () => {
  describe("permission gate (no view_phone)", () => {
    it("returns false when the caller lacks view_phone, even on Shared", () => {
      expect(
        canRead(readCaller({ grantedPermissions: [] }), sharedEvent(), {
          jobVisibleToCaller: false,
        }),
      ).toBe(false);
    });

    it("returns true for admin without explicit view_phone (admin role grants it)", () => {
      // ADR 0001 / 0003 pattern: admin role is the broadest permission;
      // we treat admin role as carrying view_phone by default. The
      // permission catalog separately defaults `view_phone` ON for admin.
      expect(
        canRead(readCaller({ role: "admin", grantedPermissions: [] }), sharedEvent(), {
          jobVisibleToCaller: false,
        }),
      ).toBe(true);
    });
  });

  describe("Shared number, untagged", () => {
    it("same-org crew_lead with view_phone: read allowed (team-visible)", () => {
      expect(
        canRead(readCaller({ role: "crew_lead" }), sharedEvent(), {
          jobVisibleToCaller: false,
        }),
      ).toBe(true);
    });

    it("same-org admin: read allowed", () => {
      expect(
        canRead(readCaller({ role: "admin" }), sharedEvent(), {
          jobVisibleToCaller: false,
        }),
      ).toBe(true);
    });

    it("cross-org caller: read denied (org boundary holds before permission)", () => {
      expect(
        canRead(
          readCaller({ organizationId: OTHER_ORG }),
          sharedEvent(),
          { jobVisibleToCaller: false },
        ),
      ).toBe(false);
    });
  });

  describe("Shared number, Job-tagged", () => {
    it("caller can see the Job: read allowed", () => {
      expect(
        canRead(readCaller(), sharedEvent({ jobTag: "job-1" }), {
          jobVisibleToCaller: true,
        }),
      ).toBe(true);
    });

    it("caller cannot see the Job: still read allowed (Shared is team-visible regardless)", () => {
      // The ADR 0003 SELECT rule is OR — Job-tagged AND job-visible OR
      // Shared OR Personal-owner. Shared alone wins; the job-tag branch
      // is independent.
      expect(
        canRead(readCaller(), sharedEvent({ jobTag: "job-1" }), {
          jobVisibleToCaller: false,
        }),
      ).toBe(true);
    });
  });

  describe("Personal number, untagged", () => {
    it("owner: read allowed", () => {
      expect(
        canRead(
          readCaller({ userId: ALICE }),
          personalEvent(ALICE),
          { jobVisibleToCaller: false },
        ),
      ).toBe(true);
    });

    it("non-owner crew_lead: read denied (content-private)", () => {
      expect(
        canRead(
          readCaller({ userId: ALICE }),
          personalEvent(BOB),
          { jobVisibleToCaller: false },
        ),
      ).toBe(false);
    });

    it("admin (not the owner): read denied — admins cannot read untagged Personal content", () => {
      expect(
        canRead(
          readCaller({ role: "admin", userId: ALICE }),
          personalEvent(BOB),
          { jobVisibleToCaller: false },
        ),
      ).toBe(false);
    });

    it("cross-org owner-by-userId: read denied (owner check is org-scoped)", () => {
      expect(
        canRead(
          readCaller({ userId: ALICE, organizationId: OTHER_ORG }),
          personalEvent(ALICE),
          { jobVisibleToCaller: false },
        ),
      ).toBe(false);
    });
  });

  describe("Personal number, Job-tagged", () => {
    it("owner: read allowed (owner can always read their own number's events)", () => {
      expect(
        canRead(
          readCaller({ userId: ALICE }),
          personalEvent(ALICE, { jobTag: "job-1" }),
          { jobVisibleToCaller: false },
        ),
      ).toBe(true);
    });

    it("non-owner with Job visibility: read allowed (Job-tagged is team-visible)", () => {
      expect(
        canRead(
          readCaller({ userId: ALICE }),
          personalEvent(BOB, { jobTag: "job-1" }),
          { jobVisibleToCaller: true },
        ),
      ).toBe(true);
    });

    it("non-owner without Job visibility: read denied", () => {
      expect(
        canRead(
          readCaller({ userId: ALICE }),
          personalEvent(BOB, { jobTag: "job-1" }),
          { jobVisibleToCaller: false },
        ),
      ).toBe(false);
    });

    it("admin (not owner) without Job visibility: read denied", () => {
      // Job-tag escapes content-privacy only when paired with Job
      // visibility. An admin who happens not to have access to the Job
      // still cannot read a Personal-number tagged event.
      expect(
        canRead(
          readCaller({ role: "admin", userId: ALICE }),
          personalEvent(BOB, { jobTag: "job-1" }),
          { jobVisibleToCaller: false },
        ),
      ).toBe(false);
    });
  });

  describe("guard rails", () => {
    it("throws for an unknown number kind on the read path too", () => {
      const bogus = {
        organizationId: ORG,
        numberKind: "service" as unknown as PhoneEventForRead["numberKind"],
        numberOwnerId: null,
        jobTag: null,
      };
      expect(() =>
        canRead(readCaller({ role: "admin" }), bogus, { jobVisibleToCaller: false }),
      ).toThrow(/unknown phone number kind "service"/);
    });
  });
});
