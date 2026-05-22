import { describe, it, expect } from "vitest";
import { admitAttachments, MAX_ATTACHMENTS_PER_MESSAGE } from "./selection";

// Issue #200 — a Jarvis message may carry up to five Chat attachments.
// `admitAttachments` is the gate: given what's already attached and what
// the user just picked or dropped, it decides how many more fit under the
// five-per-message cap and surfaces a clear message when some are turned
// away. Pure logic — exercised here with plain strings standing in for
// picked files.

describe("admitAttachments", () => {
  it("admits every file when the selection stays under the cap", () => {
    const result = admitAttachments(0, ["a.jpg", "b.jpg", "c.jpg"]);

    expect(result.accepted).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(result.rejected).toEqual([]);
    expect(result.error).toBeNull();
  });

  it("admits only up to the cap and reports the rest with a clear message", () => {
    const incoming = ["1", "2", "3", "4", "5", "6", "7"];

    const result = admitAttachments(0, incoming);

    expect(result.accepted).toEqual(["1", "2", "3", "4", "5"]);
    expect(result.rejected).toEqual(["6", "7"]);
    expect(result.accepted).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE);
    expect(result.error).toMatch(/5/);
  });

  it("counts what's already attached when admitting more", () => {
    const result = admitAttachments(3, ["1", "2", "3", "4"]);

    // Three already attached leaves room for two more.
    expect(result.accepted).toEqual(["1", "2"]);
    expect(result.rejected).toEqual(["3", "4"]);
    expect(result.error).toMatch(/5/);
  });

  it("admits nothing when the message is already at the cap", () => {
    const result = admitAttachments(5, ["1"]);

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual(["1"]);
    expect(result.error).toMatch(/5/);
  });
});
