// Issue #515 — the pure navigation model behind the full-screen Photo viewer.
// Ordering / next / prev / delete-advances / close-on-last, verified without
// rendering. The viewer's UI (arrows, swipe, keys, the deferred-delete + undo
// toast) is driven through these functions and covered in the component test.

import { describe, it, expect } from "vitest";
import type { Photo } from "@/lib/types";
import {
  orderPhotosForViewer,
  nextPhotoIndex,
  prevPhotoIndex,
  hasNext,
  hasPrev,
  indexAfterDelete,
} from "./photo-viewer-navigation";

// A Photo with only the fields the navigation model reads (created_at + id).
function photo(id: string, createdAt: string): Photo {
  return {
    id,
    organization_id: "org-1",
    job_id: "job-1",
    storage_path: `job-1/${id}.jpg`,
    annotated_path: null,
    caption: null,
    taken_at: null,
    taken_by: "Eric",
    media_type: "photo",
    file_size: null,
    width: null,
    height: null,
    before_after_pair_id: null,
    before_after_role: null,
    created_at: createdAt,
    uploaded_from: "web",
    client_capture_id: null,
  };
}

describe("orderPhotosForViewer — newest-first, continuous across date dividers", () => {
  it("returns one descending sequence regardless of input order, spanning days", () => {
    // Two days, shuffled on input. The grid draws a divider between the days,
    // but navigation is one continuous newest-first run — the divider is not a
    // navigation stop.
    const may3 = photo("may3", "2026-05-03T09:00:00Z");
    const may1 = photo("may1", "2026-05-01T15:00:00Z");
    const may2 = photo("may2", "2026-05-02T12:00:00Z");

    const ordered = orderPhotosForViewer([may1, may3, may2]);

    expect(ordered.map((p) => p.id)).toEqual(["may3", "may2", "may1"]);
  });

  it("keeps incoming order among Photos that share a timestamp (stable)", () => {
    const ts = "2026-05-02T12:00:00Z";
    const a = photo("a", ts);
    const b = photo("b", ts);
    const c = photo("c", ts);

    const ordered = orderPhotosForViewer([a, b, c]);

    expect(ordered.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
});

// index 0 is the newest Photo; higher indices are older. "Next" walks toward
// older Photos, "prev" toward newer — matching the on-screen right/left arrows.
describe("nextPhotoIndex / prevPhotoIndex — clamped at the ends", () => {
  it("next advances toward older Photos", () => {
    expect(nextPhotoIndex(0, 4)).toBe(1);
    expect(nextPhotoIndex(2, 4)).toBe(3);
  });

  it("next clamps at the oldest Photo (no wrap)", () => {
    expect(nextPhotoIndex(3, 4)).toBe(3);
  });

  it("prev moves toward newer Photos", () => {
    expect(prevPhotoIndex(3)).toBe(2);
    expect(prevPhotoIndex(1)).toBe(0);
  });

  it("prev clamps at the newest Photo (no wrap)", () => {
    expect(prevPhotoIndex(0)).toBe(0);
  });
});

// The arrows hide at the ends — there is nowhere further to go.
describe("hasNext / hasPrev — end boundaries", () => {
  it("has a next while older Photos remain, none at the oldest", () => {
    expect(hasNext(0, 3)).toBe(true);
    expect(hasNext(1, 3)).toBe(true);
    expect(hasNext(2, 3)).toBe(false);
  });

  it("has a prev once past the newest, none at the newest", () => {
    expect(hasPrev(0)).toBe(false);
    expect(hasPrev(1)).toBe(true);
  });

  it("offers neither when there is a single Photo", () => {
    expect(hasNext(0, 1)).toBe(false);
    expect(hasPrev(0)).toBe(false);
  });
});

// Deleting a Photo advances to the next one; only removing the last Photo
// closes the viewer. `count` is the size before removal.
describe("indexAfterDelete — advance to next, close on last", () => {
  it("advances to the next (older) Photo when deleting from the middle", () => {
    // 4 Photos, viewing index 1. After deleting, the Photo that was at index 2
    // slides into index 1 — staying at index 1 shows the next one.
    expect(indexAfterDelete(1, 4)).toEqual({ close: false, index: 1 });
  });

  it("advances to the next Photo when deleting the newest", () => {
    expect(indexAfterDelete(0, 3)).toEqual({ close: false, index: 0 });
  });

  it("clamps back to the new last Photo when deleting the oldest", () => {
    // Viewing the oldest (index 3 of 4). Nothing older follows, so the viewer
    // falls back to the previous Photo, now the last at index 2.
    expect(indexAfterDelete(3, 4)).toEqual({ close: false, index: 2 });
  });

  it("closes the viewer when the last remaining Photo is deleted", () => {
    expect(indexAfterDelete(0, 1)).toEqual({ close: true, index: 0 });
  });
});
