// PRD #304 — Nookleus Phone. Slice 8 (#312).
//
// Tests for the inbound Shared-number routing decision (ADR 0006 §
// "Programmable Voice with TwiML for inbound routing — ring-all /
// round-robin / forward / voicemail per-number"). Pure: no I/O.
//
// The rule lives on `phone_numbers.inbound_rule` (jsonb, Shared-only).
// Per the slice-8 design decision (issue #312, Q2): ring-all and
// round-robin dial *only the members an admin manually selected* into the
// rule — there is no role-derived roster. `decideShared` resolves those
// selected user ids against the org roster (`members`), keeps only the
// ones with a cell on file, and collapses "nobody reachable" to
// voicemail. The round-robin cursor is monotonic: it comes in, the next
// value goes out, and the caller persists it per-number so the rotation
// survives restarts.

import { describe, it, expect } from "vitest";
import { decideShared } from "./route-shared-call";

describe("decideShared — ring-all", () => {
  it("rings every manually-selected member that has a cell on file", () => {
    const result = decideShared({
      config: { kind: "ring-all", users: ["u1", "u2"] },
      members: [
        { userId: "u1", cellE164: "+15125550001" },
        { userId: "u2", cellE164: "+15125550002" },
        { userId: "u3", cellE164: "+15125550003" }, // not selected
      ],
      roundRobinCursor: 0,
    });
    expect(result).toEqual({
      kind: "ring-all",
      cells: ["+15125550001", "+15125550002"],
    });
  });

  it("falls back to voicemail when no selected member has a cell on file", () => {
    const result = decideShared({
      config: { kind: "ring-all", users: ["u1", "u2"] },
      members: [
        { userId: "u1", cellE164: null },
        { userId: "u2", cellE164: null },
      ],
      roundRobinCursor: 0,
    });
    expect(result).toEqual({ kind: "voicemail" });
  });
});

describe("decideShared — round-robin", () => {
  const roster = [
    { userId: "u1", cellE164: "+15125550001" },
    { userId: "u2", cellE164: "+15125550002" },
    { userId: "u3", cellE164: "+15125550003" },
  ];

  it("dials the member at the current cursor and advances the cursor", () => {
    const result = decideShared({
      config: { kind: "round-robin", sequence: ["u1", "u2", "u3"] },
      members: roster,
      roundRobinCursor: 0,
    });
    expect(result).toEqual({
      kind: "round-robin",
      cell: "+15125550001",
      nextCursor: 1,
    });
  });

  it("wraps to the start of the sequence as the cursor grows past its length", () => {
    const result = decideShared({
      config: { kind: "round-robin", sequence: ["u1", "u2", "u3"] },
      members: roster,
      roundRobinCursor: 3, // one full lap completed → back to the first member
    });
    expect(result).toEqual({
      kind: "round-robin",
      cell: "+15125550001",
      nextCursor: 4,
    });
  });

  it("skips sequence members without a cell, keeping the rest in order", () => {
    const result = decideShared({
      config: { kind: "round-robin", sequence: ["u1", "u2", "u3"] },
      members: [
        { userId: "u1", cellE164: "+15125550001" },
        { userId: "u2", cellE164: null }, // no cell → skipped
        { userId: "u3", cellE164: "+15125550003" },
      ],
      roundRobinCursor: 1, // second reachable member
    });
    expect(result).toEqual({
      kind: "round-robin",
      cell: "+15125550003",
      nextCursor: 2,
    });
  });

  it("falls back to voicemail when no member in the sequence has a cell", () => {
    const result = decideShared({
      config: { kind: "round-robin", sequence: ["u1", "u2"] },
      members: [
        { userId: "u1", cellE164: null },
        { userId: "u2", cellE164: null },
      ],
      roundRobinCursor: 0,
    });
    expect(result).toEqual({ kind: "voicemail" });
  });
});

describe("decideShared — single-forward", () => {
  it("forwards to the configured user's cell", () => {
    const result = decideShared({
      config: { kind: "forward", forwardUserId: "u2" },
      members: [
        { userId: "u1", cellE164: "+15125550001" },
        { userId: "u2", cellE164: "+15125550002" },
      ],
      roundRobinCursor: 0,
    });
    expect(result).toEqual({ kind: "forward", cell: "+15125550002" });
  });

  it("falls back to voicemail when the forward target has no cell on file", () => {
    const result = decideShared({
      config: { kind: "forward", forwardUserId: "u2" },
      members: [{ userId: "u2", cellE164: null }],
      roundRobinCursor: 0,
    });
    expect(result).toEqual({ kind: "voicemail" });
  });
});

describe("decideShared — voicemail and unconfigured numbers", () => {
  it("routes to voicemail when the rule is explicitly voicemail", () => {
    const result = decideShared({
      config: { kind: "voicemail" },
      members: [{ userId: "u1", cellE164: "+15125550001" }],
      roundRobinCursor: 0,
    });
    expect(result).toEqual({ kind: "voicemail" });
  });

  // Slice 3 inserts inbound_rule = NULL. With Q2 ("only manually-selected
  // members"), an unconfigured Shared number has nobody selected, so it
  // routes to voicemail until an admin configures it in Settings → Phone.
  it("routes to voicemail when the number has no rule configured (NULL)", () => {
    const result = decideShared({
      config: null,
      members: [{ userId: "u1", cellE164: "+15125550001" }],
      roundRobinCursor: 0,
    });
    expect(result).toEqual({ kind: "voicemail" });
  });
});

describe("decideShared — currentHour is a Layer-2 placeholder", () => {
  it("ignores currentHour (business-hours routing is a future slice)", () => {
    const base = {
      config: { kind: "ring-all" as const, users: ["u1"] },
      members: [{ userId: "u1", cellE164: "+15125550001" }],
      roundRobinCursor: 0,
    };
    const atNoon = decideShared({ ...base, currentHour: 12 });
    const atMidnight = decideShared({ ...base, currentHour: 0 });
    expect(atNoon).toEqual(atMidnight);
    expect(atNoon).toEqual({ kind: "ring-all", cells: ["+15125550001"] });
  });
});
