import { describe, expect, it } from "vitest";

import {
  CALL_OUTCOMES,
  recomputeDenormalizedFields,
  type CallOutcome,
  type CallLogEntry,
} from "./referral-partner-call";

const PARTNER_ID = "p-1";

function call(
  overrides: Partial<CallLogEntry> = {},
): CallLogEntry {
  return {
    id: "c-1",
    referral_partner_id: PARTNER_ID,
    called_at: "2026-05-01T10:00:00Z",
    outcome: "spoke",
    follow_up_at: null,
    ...overrides,
  };
}

describe("CALL_OUTCOMES enum", () => {
  it("exposes exactly the six outcome values from the schema check-constraint", () => {
    // The order is preserved — UI dropdowns rely on this for stable display.
    const expected: CallOutcome[] = [
      "no_answer",
      "voicemail",
      "spoke",
      "not_interested",
      "interested",
      "scheduled_followup",
    ];
    expect([...CALL_OUTCOMES]).toEqual(expected);
  });
});

describe("recomputeDenormalizedFields — first-ever call", () => {
  it("sets last_called_at, last_call_outcome, and next_follow_up_at when one call exists with a future follow-up", () => {
    const future = "2026-06-01T15:00:00Z";
    const calls: CallLogEntry[] = [
      call({ called_at: "2026-05-01T10:00:00Z", outcome: "spoke", follow_up_at: future }),
    ];
    const result = recomputeDenormalizedFields(calls, { now: "2026-05-02T00:00:00Z" });
    expect(result).toEqual({
      last_called_at: "2026-05-01T10:00:00Z",
      last_call_outcome: "spoke",
      next_follow_up_at: future,
    });
  });

  it("leaves next_follow_up_at null when the single call has no follow-up date", () => {
    const calls: CallLogEntry[] = [
      call({ outcome: "no_answer", follow_up_at: null }),
    ];
    const result = recomputeDenormalizedFields(calls, { now: "2026-05-02T00:00:00Z" });
    expect(result.last_called_at).toBe("2026-05-01T10:00:00Z");
    expect(result.last_call_outcome).toBe("no_answer");
    expect(result.next_follow_up_at).toBeNull();
  });
});

describe("recomputeDenormalizedFields — multi-call ordering", () => {
  it("a later call with a MORE RECENT called_at overwrites last_called_at and last_call_outcome", () => {
    const calls: CallLogEntry[] = [
      call({ id: "c-old", called_at: "2026-05-01T10:00:00Z", outcome: "voicemail" }),
      call({ id: "c-new", called_at: "2026-05-10T11:00:00Z", outcome: "interested" }),
    ];
    const result = recomputeDenormalizedFields(calls, { now: "2026-05-11T00:00:00Z" });
    expect(result.last_called_at).toBe("2026-05-10T11:00:00Z");
    expect(result.last_call_outcome).toBe("interested");
  });

  it("a later call with an OLDER called_at does NOT overwrite last_called_at — backdated entries don't rewind state", () => {
    const calls: CallLogEntry[] = [
      call({ id: "c-recent", called_at: "2026-05-10T11:00:00Z", outcome: "interested" }),
      call({ id: "c-backdated", called_at: "2026-04-01T09:00:00Z", outcome: "voicemail" }),
    ];
    const result = recomputeDenormalizedFields(calls, { now: "2026-05-11T00:00:00Z" });
    expect(result.last_called_at).toBe("2026-05-10T11:00:00Z");
    expect(result.last_call_outcome).toBe("interested");
  });
});

describe("recomputeDenormalizedFields — next_follow_up_at = earliest future follow-up", () => {
  it("picks the earliest follow_up_at across all calls when multiple are in the future", () => {
    const calls: CallLogEntry[] = [
      call({ id: "c-1", called_at: "2026-05-01T10:00:00Z", follow_up_at: "2026-06-15T00:00:00Z" }),
      call({ id: "c-2", called_at: "2026-05-02T10:00:00Z", follow_up_at: "2026-06-05T00:00:00Z" }),
      call({ id: "c-3", called_at: "2026-05-03T10:00:00Z", follow_up_at: "2026-07-01T00:00:00Z" }),
    ];
    const result = recomputeDenormalizedFields(calls, { now: "2026-05-04T00:00:00Z" });
    expect(result.next_follow_up_at).toBe("2026-06-05T00:00:00Z");
  });

  it("ignores past follow-up dates — only future follow-ups count", () => {
    const calls: CallLogEntry[] = [
      call({ id: "c-past", called_at: "2026-04-01T10:00:00Z", follow_up_at: "2026-04-15T00:00:00Z" }),
      call({ id: "c-future", called_at: "2026-05-01T10:00:00Z", follow_up_at: "2026-06-15T00:00:00Z" }),
    ];
    const result = recomputeDenormalizedFields(calls, { now: "2026-05-15T00:00:00Z" });
    expect(result.next_follow_up_at).toBe("2026-06-15T00:00:00Z");
  });

  it("nulls next_follow_up_at when removing the only call with a future follow-up leaves none", () => {
    // After deletion: only past follow-ups remain.
    const calls: CallLogEntry[] = [
      call({ id: "c-past", called_at: "2026-04-01T10:00:00Z", follow_up_at: "2026-04-15T00:00:00Z" }),
    ];
    const result = recomputeDenormalizedFields(calls, { now: "2026-05-15T00:00:00Z" });
    expect(result.next_follow_up_at).toBeNull();
  });
});

describe("recomputeDenormalizedFields — empty call history", () => {
  it("returns all-null denormalized fields when there are no calls", () => {
    const result = recomputeDenormalizedFields([], { now: "2026-05-15T00:00:00Z" });
    expect(result).toEqual({
      last_called_at: null,
      last_call_outcome: null,
      next_follow_up_at: null,
    });
  });
});
