// Issue #847 — the viewer's per-session edit overlay. The Photo viewer pages a
// frozen snapshot of the grid's Photos (#515) that auto-save (#806) never
// refreshes, so re-seeding an editable field on page-back would silently revert
// a just-made edit. This overlay is the viewer's memory of those edits; the
// seed effect prefers it over the snapshot. The component test covers the
// page-away-and-back behavior end-to-end — these lock in the two edge cases
// that distinguish "edited to an empty value" from "never edited".

import { describe, it, expect } from "vitest";
import type { Photo } from "@/lib/types";
import {
  rememberCaption,
  rememberRole,
  seedCaption,
  seedRole,
  type ViewerFieldEdits,
} from "./photo-viewer-field-edits";

// A Photo carrying only the fields the overlay reads (id + the two editables).
function photo(
  id: string,
  caption: string | null,
  role: Photo["before_after_role"],
): Photo {
  return {
    id,
    organization_id: "org-1",
    job_id: "job-1",
    storage_path: `job-1/${id}.jpg`,
    annotated_path: null,
    caption,
    taken_at: null,
    taken_by: "Eric",
    media_type: "photo",
    file_size: null,
    width: null,
    height: null,
    before_after_pair_id: null,
    before_after_role: role,
    created_at: "2026-05-02T10:00:00Z",
    uploaded_from: "web",
    client_capture_id: null,
  };
}

describe("seedCaption — edit overrides the snapshot, absence falls back", () => {
  it("falls back to the snapshot caption when nothing was edited", () => {
    const edits: ViewerFieldEdits = new Map();
    expect(seedCaption(edits, photo("a", "Snapshot caption", null))).toBe(
      "Snapshot caption",
    );
  });

  it("normalizes a null snapshot caption to an empty string", () => {
    const edits: ViewerFieldEdits = new Map();
    expect(seedCaption(edits, photo("a", null, null))).toBe("");
  });

  it("returns the edited caption over a differing snapshot", () => {
    const edits: ViewerFieldEdits = new Map();
    rememberCaption(edits, "a", "Edited caption");
    expect(seedCaption(edits, photo("a", "Snapshot caption", null))).toBe(
      "Edited caption",
    );
  });

  it("honors an edit that cleared the caption to an empty string", () => {
    // The user deleted the caption text. "" is a real edit, not "unedited", so
    // re-seeding must keep it empty rather than restoring the snapshot's text.
    const edits: ViewerFieldEdits = new Map();
    rememberCaption(edits, "a", "");
    expect(seedCaption(edits, photo("a", "Snapshot caption", null))).toBe("");
  });
});

describe("seedRole — edit overrides the snapshot, absence falls back", () => {
  it("falls back to the snapshot role when nothing was edited", () => {
    const edits: ViewerFieldEdits = new Map();
    expect(seedRole(edits, photo("a", null, "before"))).toBe("before");
  });

  it("returns the edited role over a differing snapshot", () => {
    const edits: ViewerFieldEdits = new Map();
    rememberRole(edits, "a", "after");
    expect(seedRole(edits, photo("a", null, "before"))).toBe("after");
  });

  it("honors an edit that cleared the role to null", () => {
    // Clicking the active role clears it. A stored null is a deliberate edit,
    // so re-seeding must keep it cleared rather than restoring the snapshot.
    const edits: ViewerFieldEdits = new Map();
    rememberRole(edits, "a", null);
    expect(seedRole(edits, photo("a", null, "before"))).toBeNull();
  });
});

describe("rememberCaption / rememberRole — independent fields per Photo", () => {
  it("keeps a remembered role when the caption is later edited", () => {
    const edits: ViewerFieldEdits = new Map();
    rememberRole(edits, "a", "after");
    rememberCaption(edits, "a", "New caption");
    const snapshot = photo("a", "Snapshot caption", "before");
    expect(seedCaption(edits, snapshot)).toBe("New caption");
    expect(seedRole(edits, snapshot)).toBe("after");
  });

  it("keeps a remembered caption when the role is later edited", () => {
    const edits: ViewerFieldEdits = new Map();
    rememberCaption(edits, "a", "New caption");
    rememberRole(edits, "a", null);
    const snapshot = photo("a", "Snapshot caption", "before");
    expect(seedRole(edits, snapshot)).toBeNull();
    expect(seedCaption(edits, snapshot)).toBe("New caption");
  });

  it("scopes edits to their own Photo id", () => {
    const edits: ViewerFieldEdits = new Map();
    rememberCaption(edits, "a", "A caption");
    // A different Photo with no edit of its own still reads from its snapshot.
    expect(seedCaption(edits, photo("b", "B snapshot", null))).toBe(
      "B snapshot",
    );
  });
});
