// PRD #304 — Nookleus Phone. Slice 5 (#309).
//
// Tests for the outbound-number selection rule (PRD § "Outbound number
// selection"). Pure: no I/O.
//
// Rule, from PRD #304:
//   1. The user's own Personal number, if they have one and it is active.
//   2. Otherwise, the Organization's primary Shared number.
//
// `phone_numbers` has no explicit primary flag (slice 3 / migration-307
// did not add one). "Primary" therefore means deterministic across
// reloads: the earliest-created active Shared number in the org. If/when
// the org grows past one Shared and the team wants to pick a different
// one, a future slice can introduce a flag.
//
// This slice never picks Personal in practice — Personal numbers don't
// land until slice 13 — but the rule must handle Personal so slice 13 is
// a one-line extension. The Personal branch is exercised by these tests
// today.

import { describe, it, expect } from "vitest";
import {
  selectOutboundNumber,
  type SelectableNumber,
} from "./select-outbound-number";

const userA = "user-a";
const orgX = "org-x";

function shared(opts: {
  id: string;
  e164: string;
  createdAt?: string;
  released?: boolean;
  active?: boolean;
}): SelectableNumber {
  return {
    id: opts.id,
    organization_id: orgX,
    e164: opts.e164,
    kind: "shared",
    user_id: null,
    released_at: opts.released ? new Date().toISOString() : null,
    is_active: opts.active ?? true,
    created_at: opts.createdAt ?? "2026-01-01T00:00:00Z",
  };
}

function personal(opts: {
  id: string;
  e164: string;
  ownerId: string;
  released?: boolean;
  active?: boolean;
}): SelectableNumber {
  return {
    id: opts.id,
    organization_id: orgX,
    e164: opts.e164,
    kind: "personal",
    user_id: opts.ownerId,
    released_at: opts.released ? new Date().toISOString() : null,
    is_active: opts.active ?? true,
    created_at: "2026-01-01T00:00:00Z",
  };
}

describe("selectOutboundNumber — Personal branch (slice 13 readiness)", () => {
  it("picks the caller's own active Personal number when they have one", () => {
    const result = selectOutboundNumber({
      callerUserId: userA,
      organizationId: orgX,
      orgNumbers: [
        shared({ id: "s1", e164: "+15125550000" }),
        personal({ id: "p1", e164: "+15125559999", ownerId: userA }),
      ],
    });
    expect(result.kind).toBe("picked");
    if (result.kind === "picked") {
      expect(result.number.id).toBe("p1");
    }
  });

  it("ignores a Personal number that belongs to a different user", () => {
    const result = selectOutboundNumber({
      callerUserId: userA,
      organizationId: orgX,
      orgNumbers: [
        shared({ id: "s1", e164: "+15125550000" }),
        personal({ id: "p2", e164: "+15125558888", ownerId: "user-b" }),
      ],
    });
    expect(result.kind).toBe("picked");
    if (result.kind === "picked") {
      expect(result.number.id).toBe("s1");
    }
  });

  it("falls back to Shared when caller's Personal is released", () => {
    const result = selectOutboundNumber({
      callerUserId: userA,
      organizationId: orgX,
      orgNumbers: [
        shared({ id: "s1", e164: "+15125550000" }),
        personal({
          id: "p1",
          e164: "+15125559999",
          ownerId: userA,
          released: true,
        }),
      ],
    });
    expect(result.kind).toBe("picked");
    if (result.kind === "picked") {
      expect(result.number.id).toBe("s1");
    }
  });

  it("falls back to Shared when caller's Personal is inactive", () => {
    const result = selectOutboundNumber({
      callerUserId: userA,
      organizationId: orgX,
      orgNumbers: [
        shared({ id: "s1", e164: "+15125550000" }),
        personal({
          id: "p1",
          e164: "+15125559999",
          ownerId: userA,
          active: false,
        }),
      ],
    });
    expect(result.kind).toBe("picked");
    if (result.kind === "picked") {
      expect(result.number.id).toBe("s1");
    }
  });
});

describe("selectOutboundNumber — Shared branch", () => {
  it("picks the earliest-created Shared when there are multiple", () => {
    const result = selectOutboundNumber({
      callerUserId: userA,
      organizationId: orgX,
      orgNumbers: [
        shared({
          id: "s-newer",
          e164: "+15125550000",
          createdAt: "2026-02-01T00:00:00Z",
        }),
        shared({
          id: "s-oldest",
          e164: "+15125551111",
          createdAt: "2026-01-01T00:00:00Z",
        }),
      ],
    });
    expect(result.kind).toBe("picked");
    if (result.kind === "picked") {
      expect(result.number.id).toBe("s-oldest");
    }
  });

  it("picks the only Shared when there's just one", () => {
    const result = selectOutboundNumber({
      callerUserId: userA,
      organizationId: orgX,
      orgNumbers: [shared({ id: "s-only", e164: "+15125550000" })],
    });
    expect(result.kind).toBe("picked");
    if (result.kind === "picked") {
      expect(result.number.id).toBe("s-only");
    }
  });

  it("ignores released Shared numbers", () => {
    const result = selectOutboundNumber({
      callerUserId: userA,
      organizationId: orgX,
      orgNumbers: [
        shared({
          id: "s-old",
          e164: "+15125550000",
          createdAt: "2026-01-01T00:00:00Z",
          released: true,
        }),
        shared({
          id: "s-new",
          e164: "+15125551111",
          createdAt: "2026-02-01T00:00:00Z",
        }),
      ],
    });
    expect(result.kind).toBe("picked");
    if (result.kind === "picked") {
      expect(result.number.id).toBe("s-new");
    }
  });

  it("ignores inactive Shared numbers", () => {
    const result = selectOutboundNumber({
      callerUserId: userA,
      organizationId: orgX,
      orgNumbers: [
        shared({
          id: "s-inactive",
          e164: "+15125550000",
          createdAt: "2026-01-01T00:00:00Z",
          active: false,
        }),
        shared({
          id: "s-live",
          e164: "+15125551111",
          createdAt: "2026-02-01T00:00:00Z",
        }),
      ],
    });
    expect(result.kind).toBe("picked");
    if (result.kind === "picked") {
      expect(result.number.id).toBe("s-live");
    }
  });
});

describe("selectOutboundNumber — no eligible number", () => {
  it("returns kind:'none' when the org has zero active Shared numbers and no caller Personal", () => {
    const result = selectOutboundNumber({
      callerUserId: userA,
      organizationId: orgX,
      orgNumbers: [],
    });
    expect(result.kind).toBe("none");
  });

  it("returns kind:'none' when all Shared are released and caller has no Personal", () => {
    const result = selectOutboundNumber({
      callerUserId: userA,
      organizationId: orgX,
      orgNumbers: [
        shared({ id: "s-old", e164: "+15125550000", released: true }),
      ],
    });
    expect(result.kind).toBe("none");
  });
});

describe("selectOutboundNumber — cross-org safety", () => {
  it("ignores numbers from other organizations", () => {
    const result = selectOutboundNumber({
      callerUserId: userA,
      organizationId: orgX,
      orgNumbers: [
        {
          id: "s-foreign",
          organization_id: "other-org",
          e164: "+15125550000",
          kind: "shared",
          user_id: null,
          released_at: null,
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    expect(result.kind).toBe("none");
  });
});
