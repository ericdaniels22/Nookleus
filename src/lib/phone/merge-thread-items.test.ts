// PRD #304 — Nookleus Phone. Slice 8 (#312) — thread interleave.
//
// `mergeThreadItems` merges a conversation's text messages and voice calls
// into one chronologically-ordered list of tagged items, so the Phone-tab
// thread can render a call and a text to the same outside number inline
// (ADR: a call threads on the same phone_conversations row as messages).
//
// Messages carry `sent_at`; calls carry `started_at`. The helper is pure
// (no I/O) and generic over the row shapes — it only reads the timestamp.

import { describe, it, expect } from "vitest";
import { mergeThreadItems } from "./merge-thread-items";

describe("mergeThreadItems", () => {
  it("interleaves a message and an earlier call in chronological order", () => {
    const items = mergeThreadItems(
      [{ id: "m1", sent_at: "2026-05-27T10:05:00Z" }],
      [{ id: "c1", started_at: "2026-05-27T10:00:00Z" }],
    );

    // The call started first, so it sorts ahead of the later message.
    expect(items.map((i) => i.kind)).toEqual(["call", "message"]);
  });

  it("fully interleaves multiple messages and calls ascending by time, breaking ties message-first", () => {
    const items = mergeThreadItems(
      [
        { id: "m-early", sent_at: "2026-05-27T09:00:00Z" },
        { id: "m-tie", sent_at: "2026-05-27T10:00:00Z" },
        { id: "m-late", sent_at: "2026-05-27T12:00:00Z" },
      ],
      [
        { id: "c-tie", started_at: "2026-05-27T10:00:00Z" },
        { id: "c-latest", started_at: "2026-05-27T13:00:00Z" },
      ],
    );

    const ids = items.map((i) =>
      i.kind === "message" ? i.message.id : i.call.id,
    );
    // Ascending by timestamp; the equal-timestamp pair is deterministic
    // (message before call) so React keys/render order never flicker.
    expect(ids).toEqual(["m-early", "m-tie", "c-tie", "m-late", "c-latest"]);
  });
});
