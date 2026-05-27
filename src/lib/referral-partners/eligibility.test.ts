// Picker-eligibility rule from ADR-0002 (issues #297 / #298).
//
// The Referrer picker (Edit Job Info dialog + intake form) and the server-side
// PATCH `/api/jobs/[id]` both consume this single source of truth so the rule
// is impossible to drift between surfaces.
//
// A row is `pickable` when its Lifecycle is Active (`green`) and it has not
// been trashed; `promote-then-pick` when it is a yellow Target (still on the
// cold-call list, the picker offers `+ Promote and attach`); `hidden` for
// every other combination (grey, red, or any trashed row).

import { describe, expect, it } from "vitest";

import { eligibilityFor } from "./eligibility";

describe("eligibilityFor — Lifecycle status x deleted_at", () => {
  it("an Active (green) partner that has not been trashed is pickable", () => {
    expect(
      eligibilityFor({ status: "green", deleted_at: null }),
    ).toBe("pickable");
  });

  it("a yellow Target that has not been trashed must be promoted first", () => {
    expect(
      eligibilityFor({ status: "yellow", deleted_at: null }),
    ).toBe("promote-then-pick");
  });

  it("a grey (Uncontacted) row is hidden — not surfaced in the picker", () => {
    expect(
      eligibilityFor({ status: "grey", deleted_at: null }),
    ).toBe("hidden");
  });

  it("a red (Declined) row is hidden — past partners do not appear", () => {
    expect(
      eligibilityFor({ status: "red", deleted_at: null }),
    ).toBe("hidden");
  });

  it("a trashed Active partner is hidden even though Lifecycle is green", () => {
    expect(
      eligibilityFor({ status: "green", deleted_at: "2026-05-20T00:00:00Z" }),
    ).toBe("hidden");
  });

  it("a trashed yellow Target is hidden — no Promote-and-attach for trashed rows", () => {
    expect(
      eligibilityFor({ status: "yellow", deleted_at: "2026-05-20T00:00:00Z" }),
    ).toBe("hidden");
  });

  it("a trashed grey row is hidden", () => {
    expect(
      eligibilityFor({ status: "grey", deleted_at: "2026-05-20T00:00:00Z" }),
    ).toBe("hidden");
  });

  it("a trashed red row is hidden", () => {
    expect(
      eligibilityFor({ status: "red", deleted_at: "2026-05-20T00:00:00Z" }),
    ).toBe("hidden");
  });
});
