// issue #706 (parent epic #699) — the pure "needs attention" derivation.
//
// An Open Time session whose elapsed time exceeds ~12h is work for the lead
// (typically a forgotten clock-out). The amber/needs-attention state is PURELY
// derived from elapsed time on a still-Open session — it mutates nothing and
// never closes the session (the lead supplies the clock-out via a Correction).
// A closed session never needs attention, however long it ran.

import { describe, it, expect } from "vitest";
import {
  needsAttention,
  selectNeedsAttention,
  NEEDS_ATTENTION_THRESHOLD_MS,
} from "./needs-attention";

const NOW = "2026-06-20T12:00:00.000Z";

// Each case: [label, startedAt, endedAt, expected]
const cases: Array<[string, string, string | null, boolean]> = [
  ["Open 8h — under threshold", "2026-06-20T04:00:00.000Z", null, false],
  ["Open exactly 12h — not yet exceeded", "2026-06-20T00:00:00.000Z", null, false],
  ["Open 12h + 1ms — just exceeded", "2026-06-19T23:59:59.999Z", null, true],
  ["Open 13h — well over", "2026-06-19T23:00:00.000Z", null, true],
  ["Closed 20h span — never needs attention", "2026-06-19T16:00:00.000Z", NOW, false],
];

describe("needsAttention", () => {
  it.each(cases)("%s → %s", (_label, startedAt, endedAt, expected) => {
    expect(needsAttention({ startedAt, endedAt }, NOW)).toBe(expected);
  });

  it("exposes the ~12h threshold", () => {
    expect(NEEDS_ATTENTION_THRESHOLD_MS).toBe(12 * 60 * 60 * 1000);
  });
});

describe("selectNeedsAttention", () => {
  it("keeps only the Open sessions past the threshold, in input order", () => {
    const sessions = [
      { id: "a", startedAt: "2026-06-20T04:00:00.000Z", endedAt: null }, // 8h open — no
      { id: "b", startedAt: "2026-06-19T23:00:00.000Z", endedAt: null }, // 13h open — yes
      { id: "c", startedAt: "2026-06-19T16:00:00.000Z", endedAt: NOW }, // closed — no
      { id: "d", startedAt: "2026-06-19T18:00:00.000Z", endedAt: null }, // 18h open — yes
    ];
    expect(selectNeedsAttention(sessions, NOW).map((s) => s.id)).toEqual(["b", "d"]);
  });
});
