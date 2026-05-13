import { describe, it, expect } from "vitest";
import { computeRestoreTargetStatus } from "./restore-target-status";

// Restoring a voided contract: derive the target lifecycle status from
// timestamps already on the row, in this order (first match wins):
//   signed_at IS NOT NULL              → 'signed'
//   first_viewed_at IS NOT NULL        → 'viewed'
//   sent_at IS NOT NULL                → 'sent'
//   otherwise                          → 'draft'

describe("computeRestoreTargetStatus — signed branch", () => {
  it("returns 'signed' when signed_at is non-null", () => {
    expect(
      computeRestoreTargetStatus({
        signed_at: "2026-05-13T12:00:00Z",
        first_viewed_at: null,
        sent_at: null,
      }),
    ).toBe("signed");
  });
});

describe("computeRestoreTargetStatus — viewed branch", () => {
  it("returns 'viewed' when signed_at is null but first_viewed_at is set", () => {
    expect(
      computeRestoreTargetStatus({
        signed_at: null,
        first_viewed_at: "2026-05-13T11:00:00Z",
        sent_at: "2026-05-13T10:00:00Z",
      }),
    ).toBe("viewed");
  });
});

describe("computeRestoreTargetStatus — sent branch", () => {
  it("returns 'sent' when only sent_at is set", () => {
    expect(
      computeRestoreTargetStatus({
        signed_at: null,
        first_viewed_at: null,
        sent_at: "2026-05-13T10:00:00Z",
      }),
    ).toBe("sent");
  });
});

describe("computeRestoreTargetStatus — draft fallback", () => {
  it("returns 'draft' when all three timestamps are null", () => {
    expect(
      computeRestoreTargetStatus({
        signed_at: null,
        first_viewed_at: null,
        sent_at: null,
      }),
    ).toBe("draft");
  });
});

describe("computeRestoreTargetStatus — precedence", () => {
  it("returns 'signed' when all three timestamps are set (signed wins)", () => {
    expect(
      computeRestoreTargetStatus({
        signed_at: "2026-05-13T12:00:00Z",
        first_viewed_at: "2026-05-13T11:00:00Z",
        sent_at: "2026-05-13T10:00:00Z",
      }),
    ).toBe("signed");
  });
});
