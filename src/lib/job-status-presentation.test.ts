import { describe, expect, it } from "vitest";

import {
  getJobStatusOptions,
  getJobStatusPresentation,
  isOpenJobStatus,
  JOB_STATUS_PRESENTATION,
} from "./job-status-presentation";

// Issue #720 (PRD #719, ADR 0022) — the Job lifecycle relabels to the
// pipeline Lead → Active → Collections → Closed → Lost as a DISPLAY-only
// change. The snake_case keys stay frozen; this module is the code-side
// source of truth for the facets job_statuses can't carry (icon, stripe
// accent, pipeline rank, Open verdict) plus the default label/badge colors.

describe("getJobStatusPresentation", () => {
  it("relabels the `new` key to Lead — an open stage at pipeline rank 1", () => {
    const lead = getJobStatusPresentation("new");
    expect(lead.label).toBe("Lead");
    expect(lead.isOpen).toBe(true);
    expect(lead.sortRank).toBe(1);
  });

  // Display-only relabel of the five frozen keys (ADR 0022).
  const labels: Array<[string, string]> = [
    ["new", "Lead"],
    ["in_progress", "Active"],
    ["pending_invoice", "Collections"],
    ["completed", "Closed"],
    ["cancelled", "Lost 😢"],
  ];
  it.each(labels)("relabels %s to %s", (key, label) => {
    expect(getJobStatusPresentation(key).label).toBe(label);
  });
});

describe("isOpenJobStatus", () => {
  // Open job = Lead / Active / Collections; Closed and Lost are dead stages.
  const cases: Array<[string, boolean]> = [
    ["new", true],
    ["in_progress", true],
    ["pending_invoice", true],
    ["completed", false],
    ["cancelled", false],
  ];
  it.each(cases)("treats %s as open=%s", (key, expected) => {
    expect(isOpenJobStatus(key)).toBe(expected);
    expect(getJobStatusPresentation(key).isOpen).toBe(expected);
  });
});

describe("JOB_STATUS_PRESENTATION completeness", () => {
  const KNOWN_KEYS = [
    "new",
    "in_progress",
    "pending_invoice",
    "completed",
    "cancelled",
  ] as const;

  it("covers exactly the five frozen lifecycle keys", () => {
    expect(Object.keys(JOB_STATUS_PRESENTATION).sort()).toEqual(
      [...KNOWN_KEYS].sort(),
    );
  });

  it.each(KNOWN_KEYS)(
    "gives %s a non-empty label, icon, accent, and badge colors",
    (key) => {
      const p = JOB_STATUS_PRESENTATION[key];
      expect(p.label.trim().length).toBeGreaterThan(0);
      expect(p.icon.trim().length).toBeGreaterThan(0);
      expect(p.accentColor.trim().length).toBeGreaterThan(0);
      expect(p.badge.bg.trim().length).toBeGreaterThan(0);
      expect(p.badge.text.trim().length).toBeGreaterThan(0);
    },
  );
});

describe("Lost is visually distinct from Closed", () => {
  // The whole point of the relabel: Closed and Lost both render warm grey
  // today; Lost (cancelled) must move to a muted rose so it no longer looks
  // identical to grey Closed (completed).
  it("gives Lost a different badge + accent than Closed", () => {
    const closed = getJobStatusPresentation("completed");
    const lost = getJobStatusPresentation("cancelled");
    expect(lost.badge.bg).not.toBe(closed.badge.bg);
    expect(lost.badge.text).not.toBe(closed.badge.text);
    expect(lost.accentColor).not.toBe(closed.accentColor);
  });
});

describe("pipeline sort order", () => {
  it("ranks the stages Lead → Active → Collections → Closed → Lost", () => {
    const ranks = [
      "new",
      "in_progress",
      "pending_invoice",
      "completed",
      "cancelled",
    ].map((k) => getJobStatusPresentation(k).sortRank);
    expect(ranks).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("unknown status keys", () => {
  it("falls back to the raw key, dead + sorted last, with usable defaults", () => {
    const p = getJobStatusPresentation("some_custom_org_status");
    expect(p.key).toBe("some_custom_org_status");
    expect(p.label).toBe("some_custom_org_status");
    expect(p.isOpen).toBe(false);
    expect(p.sortRank).toBeGreaterThan(5); // sorts after the five known stages
    expect(p.icon.trim().length).toBeGreaterThan(0);
    expect(p.accentColor.trim().length).toBeGreaterThan(0);
    expect(p.badge.bg.trim().length).toBeGreaterThan(0);
    expect(p.badge.text.trim().length).toBeGreaterThan(0);
  });
});

// Issue #722 (PRD #719) — the Job-detail status picker reads its five options
// from config instead of a hardcoded <option> list. getJobStatusOptions builds
// that list: the five frozen stages in pipeline order, each labelled by the
// org's display_label when present, else the canonical label. One source of
// truth, so the picker never drifts from the badges shown elsewhere.
describe("getJobStatusOptions", () => {
  it("returns the five stages in pipeline order", () => {
    const options = getJobStatusOptions();
    expect(options.map((o) => o.value)).toEqual([
      "new",
      "in_progress",
      "pending_invoice",
      "completed",
      "cancelled",
    ]);
  });

  it("labels the stages with the canonical pipeline labels when given no config", () => {
    expect(getJobStatusOptions().map((o) => o.label)).toEqual([
      "Lead",
      "Active",
      "Collections",
      "Closed",
      "Lost 😢",
    ]);
  });

  it("uses an org's display_label override for a stage when config provides it", () => {
    const options = getJobStatusOptions([
      { name: "new", display_label: "Prospect" },
    ]);
    const lead = options.find((o) => o.value === "new");
    expect(lead?.label).toBe("Prospect");
    // Stages without an override keep their canonical label.
    expect(options.find((o) => o.value === "in_progress")?.label).toBe("Active");
  });

  it("ignores config rows for keys outside the five frozen stages", () => {
    const options = getJobStatusOptions([
      { name: "archived", display_label: "Archived" },
      { name: "on_hold", display_label: "On Hold" },
    ]);
    expect(options).toHaveLength(5);
    expect(options.map((o) => o.value)).not.toContain("archived");
    expect(options.map((o) => o.value)).not.toContain("on_hold");
  });

  it("falls back to the canonical label for stages a partial config omits", () => {
    // Config carries only Collections — the other four keep canonical labels.
    const options = getJobStatusOptions([
      { name: "pending_invoice", display_label: "Awaiting Payment" },
    ]);
    expect(options.map((o) => o.label)).toEqual([
      "Lead",
      "Active",
      "Awaiting Payment",
      "Closed",
      "Lost 😢",
    ]);
  });

  it("falls back to the canonical label when a config override is blank or whitespace-only", () => {
    // A blank/whitespace display_label must never erase a stage's visible label
    // — the picker always shows the five stages, so an empty override is ignored.
    const options = getJobStatusOptions([
      { name: "new", display_label: "" },
      { name: "in_progress", display_label: "   " },
    ]);
    expect(options.find((o) => o.value === "new")?.label).toBe("Lead");
    expect(options.find((o) => o.value === "in_progress")?.label).toBe("Active");
  });
});
