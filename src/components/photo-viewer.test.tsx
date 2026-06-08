// Issue #513 — Full-screen Photo viewer (slice 1A: field parity, replaces the
// Photo Details modal). Behavior of the viewer driven through the DOM, mocking
// the Supabase client (to capture the same writes the modal did), the active-org
// helper, and sonner. Follows the RTL + mocked-Supabase pattern in
// photo-report-builder.test.tsx. No jest-dom matchers (none configured) —
// assertions use toBeTruthy()/toBe()/call spies.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

import type { Photo, PhotoTag } from "@/lib/types";
import { photoUrl } from "@/lib/jobs/photo-url";

const SUPABASE_URL = "https://example.supabase.co";

// Shared mock state. Each Supabase operation is a spy so a test can assert the
// exact write the viewer made; `tagAssignments`/`listResult` seed the two reads
// the mount effect performs (tag assignments + crop-backup probe) so it never
// throws. Mutate them before render to drive a branch.
const h = vi.hoisted(() => ({
  update: vi.fn(),
  updateEq: vi.fn(),
  del: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  tagAssignments: [] as { tag_id: string }[],
  listResult: [] as { name: string }[],
}));

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => {
        h.update(table, payload);
        return {
          eq: async (col: string, val: unknown) => {
            h.updateEq(table, col, val);
            return { error: null };
          },
        };
      },
      delete: () => ({
        eq: async (col: string, val: unknown) => {
          h.del(table, col, val);
          return { error: null };
        },
      }),
      insert: async (rows: unknown) => {
        h.insert(table, rows);
        return { error: null };
      },
      select: (cols: string) => ({
        eq: async (col: string, val: unknown) => {
          h.select(table, cols, col, val);
          return {
            data: table === "photo_tag_assignments" ? h.tagAssignments : [],
          };
        },
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          h.remove(bucket, paths);
          return { error: null };
        },
        list: async (prefix: string, opts: unknown) => {
          h.list(bucket, prefix, opts);
          return { data: h.listResult };
        },
        download: async (path: string) => {
          h.download(bucket, path);
          return { data: new Blob(["x"], { type: "image/jpeg" }) };
        },
        upload: async (path: string, blob: unknown, opts: unknown) => {
          h.upload(bucket, path, opts);
          return { error: null };
        },
      }),
    },
  }),
}));

vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(async () => "org-1"),
}));

// `toast` is both callable (the Undo toast: toast(msg, { action })) and a
// namespace of variants (toast.success / .error).
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

// The platform share/download plumbing is its own tested seam (#518); the
// viewer's job is only to call it with the right version + filename + mode, so
// mock it and assert the hand-off.
vi.mock("@/lib/share/share-or-download", () => ({
  shareOrDownloadFile: vi.fn(async () => {}),
}));

import { toast } from "sonner";
import { shareOrDownloadFile } from "@/lib/share/share-or-download";
import { exportVersion } from "@/lib/jobs/photo-export-version";
import PhotoViewer from "./photo-viewer";

function makePhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: "p1",
    organization_id: "org-1",
    job_id: "job-1",
    storage_path: "job-1/p1.jpg",
    annotated_path: null,
    caption: null,
    taken_at: null,
    taken_by: "Eric Daniels",
    media_type: "photo",
    file_size: 2_097_152, // 2 MB
    width: 4000,
    height: 3000,
    before_after_pair_id: null,
    before_after_role: null,
    created_at: "2026-05-01T15:30:00Z",
    uploaded_from: "web",
    client_capture_id: null,
    ...overrides,
  };
}

function makeTag(id: string, name: string): PhotoTag {
  return {
    id,
    organization_id: "org-1",
    name,
    color: "#2B5EA7",
    created_by: "Eric",
    created_at: "2026-05-01T00:00:00Z",
  };
}

function renderViewer(
  props: Partial<React.ComponentProps<typeof PhotoViewer>> = {},
) {
  const photo = makePhoto();
  const onOpenChange = vi.fn();
  const onUpdated = vi.fn();
  const onAnnotate = vi.fn();
  const result = render(
    <PhotoViewer
      open
      onOpenChange={onOpenChange}
      photos={[photo]}
      initialPhotoIndex={0}
      allTags={[]}
      supabaseUrl={SUPABASE_URL}
      coverPhotoId={null}
      onUpdated={onUpdated}
      onAnnotate={onAnnotate}
      {...props}
    />,
  );
  return { photo, onOpenChange, onUpdated, onAnnotate, ...result };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.tagAssignments = [];
  h.listResult = [];
});

describe("PhotoViewer — display", () => {
  it("renders the opened Photo full-resolution on a full-screen surface", () => {
    const { photo } = renderViewer();

    const img = screen.getByRole("img") as HTMLImageElement;
    // Field parity: the modal showed photoUrl(photo, url, "full"), which prefers
    // the annotated copy when present — the viewer must match exactly.
    expect(img.getAttribute("src")).toBe(photoUrl(photo, SUPABASE_URL, "full"));
  });

  it("shows read-only metadata: uploader, date, and file size in MB", () => {
    renderViewer({
      photos: [makePhoto({ taken_by: "Eric Daniels", file_size: 2_097_152 })],
    });

    expect(screen.getByText(/Eric Daniels/)).toBeTruthy();
    // Date is shown; assert the year (timezone-stable, unlike day/hour).
    expect(screen.getByText(/2026/)).toBeTruthy();
    expect(screen.getByText(/2\.0 MB/)).toBeTruthy();
  });
});

describe("PhotoViewer — Save (caption / Before-After / tags)", () => {
  it("persists an edited caption to the photos row on Save", async () => {
    const { photo } = renderViewer();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Caption"), {
        target: { value: "Roof damage to NE corner" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    });

    expect(h.update).toHaveBeenCalledWith(
      "photos",
      expect.objectContaining({ caption: "Roof damage to NE corner" }),
    );
    expect(h.updateEq).toHaveBeenCalledWith("photos", "id", photo.id);
  });

  it("persists a Before/After role on Save", async () => {
    renderViewer();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "After" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    });

    expect(h.update).toHaveBeenCalledWith(
      "photos",
      expect.objectContaining({ before_after_role: "after" }),
    );
  });

  it("clears Before/After when the active role is toggled off", async () => {
    renderViewer({ photos: [makePhoto({ before_after_role: "before" })] });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Before" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    });

    expect(h.update).toHaveBeenCalledWith(
      "photos",
      expect.objectContaining({ before_after_role: null }),
    );
  });

  it("pre-selects a Photo's existing tag assignments", async () => {
    h.tagAssignments = [{ tag_id: "tag-a" }];
    renderViewer({ allTags: [makeTag("tag-a", "Roof"), makeTag("tag-b", "Water")] });

    // Let the mount-effect tag read resolve.
    await act(async () => {});

    const selected = screen.getByRole("button", { name: "Roof" }) as HTMLElement;
    const unselected = screen.getByRole("button", { name: "Water" }) as HTMLElement;
    expect(selected.style.backgroundColor).toBeTruthy();
    expect(unselected.style.backgroundColor).toBeFalsy();
  });

  it("replaces tag assignments (delete-all-then-insert) on Save", async () => {
    const { photo } = renderViewer({
      allTags: [makeTag("tag-a", "Roof"), makeTag("tag-b", "Water")],
    });
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Roof" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    });

    expect(h.del).toHaveBeenCalledWith(
      "photo_tag_assignments",
      "photo_id",
      photo.id,
    );
    expect(h.insert).toHaveBeenCalledWith(
      "photo_tag_assignments",
      expect.arrayContaining([
        expect.objectContaining({
          organization_id: "org-1",
          photo_id: photo.id,
          tag_id: "tag-a",
        }),
      ]),
    );
  });
});

describe("PhotoViewer — toolbar actions", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        urls: [{ url: "https://signed.example/p1.jpg", filename: "p1.jpg" }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Download requests the original via the job's download route", async () => {
    const { photo } = renderViewer();
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /download/i }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/jobs/${photo.job_id}/photos/download`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ photoIds: [photo.id] }),
      }),
    );
  });

  it("Delete asks for confirmation before hard-deleting", async () => {
    renderViewer();
    await act(async () => {});

    // Arming Delete must NOT delete yet.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    });
    expect(h.del).not.toHaveBeenCalledWith("photos", "id", expect.anything());
  });

  it("Edit hands off to the Annotator with the photo and its display URL", async () => {
    const { photo, onAnnotate } = renderViewer();
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    });

    expect(onAnnotate).toHaveBeenCalledWith(
      photo,
      photoUrl(photo, SUPABASE_URL, "full"),
    );
  });
});

describe("PhotoViewer — delete (deferred advance + Undo)", () => {
  const UNDO_WINDOW_MS = 5000;

  // Three Photos so "advance to the next" is observable.
  const a = makePhoto({ id: "a", storage_path: "job-1/a.jpg", created_at: "2026-05-03T10:00:00Z" });
  const b = makePhoto({ id: "b", storage_path: "job-1/b.jpg", created_at: "2026-05-02T10:00:00Z" });
  const c = makePhoto({ id: "c", storage_path: "job-1/c.jpg", created_at: "2026-05-01T10:00:00Z" });
  const trio = [a, b, c];

  const src = () => (screen.getByRole("img") as HTMLImageElement).getAttribute("src");

  async function confirmDelete() {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    });
  }

  // Pull the Undo handler out of the last toast(message, { action }) call.
  function lastUndo(): () => void {
    const call = (toast as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1);
    const opts = call?.[1] as { action?: { label: string; onClick: () => void } };
    return opts!.action!.onClick;
  }

  it("advances to the next Photo and shows an Undo toast, deferring the delete", async () => {
    const { onOpenChange } = renderViewer({ photos: trio, initialPhotoIndex: 0 });
    await act(async () => {});
    expect(src()).toBe(photoUrl(a, SUPABASE_URL, "full"));

    await confirmDelete();

    // Advanced to the next Photo, viewer stays open.
    expect(src()).toBe(photoUrl(b, SUPABASE_URL, "full"));
    expect(onOpenChange).not.toHaveBeenCalled();
    // An Undo toast was shown…
    expect(toast).toHaveBeenCalledWith(
      expect.stringMatching(/deleted/i),
      expect.objectContaining({
        action: expect.objectContaining({ label: expect.stringMatching(/undo/i) }),
      }),
    );
    // …and the hard delete has NOT fired yet (it waits out the window).
    expect(h.del).not.toHaveBeenCalledWith("photos", "id", "a");
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("closes the viewer when the last remaining Photo is deleted", async () => {
    const { onOpenChange } = renderViewer({ photos: [a], initialPhotoIndex: 0 });
    await act(async () => {});

    await confirmDelete();

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast).toHaveBeenCalledWith(
      expect.stringMatching(/deleted/i),
      expect.objectContaining({
        action: expect.objectContaining({ label: expect.stringMatching(/undo/i) }),
      }),
    );
  });

  it("commits the hard delete once the Undo window elapses", async () => {
    vi.useFakeTimers();
    try {
      const { onUpdated } = renderViewer({ photos: trio, initialPhotoIndex: 0 });
      await act(async () => {});
      await confirmDelete();

      // Nothing committed mid-window.
      expect(h.remove).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(UNDO_WINDOW_MS);
      });
      await act(async () => {}); // flush the commit's awaited writes

      expect(h.remove).toHaveBeenCalledWith("photos", [a.storage_path]);
      expect(h.del).toHaveBeenCalledWith("photos", "id", "a");
      expect(onUpdated).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Undo cancels the commit and restores the Photo", async () => {
    vi.useFakeTimers();
    try {
      renderViewer({ photos: trio, initialPhotoIndex: 0 });
      await act(async () => {});
      await confirmDelete();
      expect(src()).toBe(photoUrl(b, SUPABASE_URL, "full"));

      // Undo within the window.
      await act(async () => {
        lastUndo()();
      });

      // The deleted Photo is back…
      expect(src()).toBe(photoUrl(a, SUPABASE_URL, "full"));

      // …and the window elapsing never deletes it.
      await act(async () => {
        vi.advanceTimersByTime(UNDO_WINDOW_MS);
      });
      await act(async () => {});
      expect(h.remove).not.toHaveBeenCalled();
      expect(h.del).not.toHaveBeenCalledWith("photos", "id", "a");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PhotoViewer — Restore original", () => {
  it("is hidden when the Photo has no backup or annotation", async () => {
    renderViewer();
    await act(async () => {});

    expect(
      screen.queryByRole("button", { name: /restore original/i }),
    ).toBeNull();
  });

  it("restores an annotated Photo to its original and closes", async () => {
    const { photo, onUpdated, onOpenChange } = renderViewer({
      photos: [makePhoto({ annotated_path: "job-1/p1-annotated.png" })],
    });
    // Let the mount-effect backup probe resolve so the button appears.
    await act(async () => {});

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /restore original/i }),
      );
    });

    expect(h.remove).toHaveBeenCalledWith("photos", ["job-1/p1-annotated.png"]);
    expect(h.update).toHaveBeenCalledWith(
      "photos",
      expect.objectContaining({ annotated_path: null }),
    );
    expect(h.del).toHaveBeenCalledWith(
      "photo_annotations",
      "photo_id",
      photo.id,
    );
    expect(onUpdated).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("PhotoViewer — close", () => {
  it("closes back to the Job when ✕ is clicked", async () => {
    const { onOpenChange } = renderViewer();
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /close/i }));
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes when Escape is pressed", async () => {
    const { onOpenChange } = renderViewer();
    await act(async () => {});

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("PhotoViewer — Set as cover (⋯ More)", () => {
  it("Set as cover writes the Job's cover_photo_id to the current Photo", async () => {
    const { photo } = renderViewer();
    await act(async () => {});

    // Open the ⋯ More menu, then choose Set as cover (the existing direct
    // write the grid's star uses: jobs.cover_photo_id = this photo).
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /more/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /set as cover/i }));
    });

    expect(h.update).toHaveBeenCalledWith(
      "jobs",
      expect.objectContaining({ cover_photo_id: photo.id }),
    );
    expect(h.updateEq).toHaveBeenCalledWith("jobs", "id", photo.job_id);
  });

  it("refetches (onUpdated) so the grid reflects the new cover, and toasts success", async () => {
    const { onUpdated } = renderViewer();
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /more/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /set as cover/i }));
    });

    expect(onUpdated).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringMatching(/cover/i),
    );
  });

  it("reflects cover state: the menu entry is a disabled 'Cover photo', not an action", async () => {
    const photo = makePhoto();
    renderViewer({ photos: [photo], coverPhotoId: photo.id });
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /more/i }));
    });

    // It no longer offers to set the cover — it states the current one.
    expect(
      screen.queryByRole("button", { name: /set as cover/i }),
    ).toBeNull();
    const entry = screen.getByRole("button", {
      name: /cover photo/i,
    }) as HTMLButtonElement;
    expect(entry.disabled).toBe(true);
  });
});

describe("PhotoViewer — Share / Save to device (⋯ More)", () => {
  it("Save to device hands the displayed version + filename to the plumbing in save mode", async () => {
    const { photo } = renderViewer();
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /more/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save to device/i }));
    });

    expect(shareOrDownloadFile).toHaveBeenCalledWith({
      ...exportVersion(photo, SUPABASE_URL, "save"),
      mode: "save",
    });
  });

  it("Share opens the share sheet with the displayed version in share mode", async () => {
    const { photo } = renderViewer();
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /more/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /share/i }));
    });

    expect(shareOrDownloadFile).toHaveBeenCalledWith({
      ...exportVersion(photo, SUPABASE_URL, "share"),
      mode: "share",
    });
  });

  it("acts on the annotated render when the Photo has been drawn on", async () => {
    const annotated = makePhoto({
      annotated_path: "job-1/p1-annotated.png",
      caption: "Roof",
    });
    renderViewer({ photos: [annotated] });
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /more/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save to device/i }));
    });

    // The displayed version is the annotated copy: its URL, and a name carrying
    // the render's .png extension.
    const arg = vi.mocked(shareOrDownloadFile).mock.calls[0][0];
    expect(arg.url).toBe(photoUrl(annotated, SUPABASE_URL, "full"));
    expect(arg.filename).toBe("Roof.png");
  });

  it("closes the ⋯ menu after an export", async () => {
    renderViewer();
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /more/i }));
    });
    expect(
      screen.queryByRole("button", { name: /save to device/i }),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save to device/i }));
    });

    expect(
      screen.queryByRole("button", { name: /save to device/i }),
    ).toBeNull();
  });
});

describe("PhotoViewer — Duplicate (⋯ More)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "p2", job_id: "job-1" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the duplicate endpoint for the current Photo, then refetches and toasts", async () => {
    const { photo, onUpdated } = renderViewer();
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /more/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /duplicate/i }));
    });

    // The clean same-Job copy is the endpoint's job (Storage copy + new row +
    // tag re-link); the viewer only kicks it off for the current Photo.
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/jobs/${photo.job_id}/photos/${photo.id}/duplicate`,
      expect.objectContaining({ method: "POST" }),
    );
    // The grid refetches so the new copy shows up, and the user is told.
    expect(onUpdated).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/duplicat/i));
    // The ⋯ menu closes after the action.
    expect(screen.queryByRole("button", { name: /duplicate/i })).toBeNull();
  });

  it("is offered for a video too (it copies the original file)", async () => {
    renderViewer({ photos: [makePhoto({ media_type: "video", storage_path: "job-1/clip.mp4" })] });
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /more/i }));
    });

    expect(screen.queryByRole("button", { name: /duplicate/i })).toBeTruthy();
  });

  it("warns and does not refetch when the duplicate request fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "nope" }) });
    const { onUpdated } = renderViewer();
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /more/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /duplicate/i }));
    });

    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/duplicat/i));
    expect(onUpdated).not.toHaveBeenCalled();
  });
});

describe("PhotoViewer — Cover indicator", () => {
  it("shows a Cover badge when the current Photo is the Job's cover", async () => {
    const photo = makePhoto();
    renderViewer({ photos: [photo], coverPhotoId: photo.id });
    await act(async () => {});

    expect(screen.getByTitle(/current cover/i)).toBeTruthy();
  });

  it("hides the Cover badge when the current Photo is not the cover", async () => {
    const photo = makePhoto();
    renderViewer({ photos: [photo], coverPhotoId: "a-different-photo" });
    await act(async () => {});

    expect(screen.queryByTitle(/current cover/i)).toBeNull();
  });
});

describe("PhotoViewer — navigation across the Job's Photos", () => {
  // Two days, deliberately out of order on input — the viewer orders them
  // newest-first and walks one continuous run across the grid's date divider.
  const newest = makePhoto({
    id: "p-new",
    storage_path: "job-1/new.jpg",
    created_at: "2026-05-03T10:00:00Z",
  });
  const middle = makePhoto({
    id: "p-mid",
    storage_path: "job-1/mid.jpg",
    created_at: "2026-05-02T10:00:00Z",
  });
  const oldest = makePhoto({
    id: "p-old",
    storage_path: "job-1/old.jpg",
    created_at: "2026-05-01T10:00:00Z",
  });
  const shuffled = [middle, oldest, newest];

  const src = () => (screen.getByRole("img") as HTMLImageElement).getAttribute("src");

  it("Next advances to the next (older) Photo, continuous across dates", async () => {
    // Open on the newest; one Next crosses the May 3 → May 2 divider.
    renderViewer({ photos: shuffled, initialPhotoIndex: shuffled.indexOf(newest) });
    await act(async () => {});
    expect(src()).toBe(photoUrl(newest, SUPABASE_URL, "full"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
    });
    expect(src()).toBe(photoUrl(middle, SUPABASE_URL, "full"));
  });

  it("ArrowRight / ArrowLeft move between Photos", async () => {
    renderViewer({ photos: shuffled, initialPhotoIndex: shuffled.indexOf(newest) });
    await act(async () => {});

    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowRight" });
    });
    expect(src()).toBe(photoUrl(middle, SUPABASE_URL, "full"));

    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowLeft" });
    });
    expect(src()).toBe(photoUrl(newest, SUPABASE_URL, "full"));
  });

  it("swiping left shows the next Photo, swiping right the previous", async () => {
    renderViewer({ photos: shuffled, initialPhotoIndex: shuffled.indexOf(newest) });
    await act(async () => {});
    const surface = screen.getByRole("img").parentElement as HTMLElement;

    // Finger travels right → left: advance to the next (older) Photo.
    await act(async () => {
      fireEvent.touchStart(surface, { touches: [{ clientX: 240 }] });
      fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 80 }] });
    });
    expect(src()).toBe(photoUrl(middle, SUPABASE_URL, "full"));

    // Finger travels left → right: back to the previous (newer) Photo.
    await act(async () => {
      fireEvent.touchStart(surface, { touches: [{ clientX: 80 }] });
      fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 240 }] });
    });
    expect(src()).toBe(photoUrl(newest, SUPABASE_URL, "full"));
  });

  it("ignores a tap that does not pass the swipe threshold", async () => {
    renderViewer({ photos: shuffled, initialPhotoIndex: shuffled.indexOf(newest) });
    await act(async () => {});
    const surface = screen.getByRole("img").parentElement as HTMLElement;

    await act(async () => {
      fireEvent.touchStart(surface, { touches: [{ clientX: 200 }] });
      fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 188 }] });
    });
    expect(src()).toBe(photoUrl(newest, SUPABASE_URL, "full"));
  });

  it("Prev returns to the newer Photo", async () => {
    renderViewer({ photos: shuffled, initialPhotoIndex: shuffled.indexOf(middle) });
    await act(async () => {});
    expect(src()).toBe(photoUrl(middle, SUPABASE_URL, "full"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /previous/i }));
    });
    expect(src()).toBe(photoUrl(newest, SUPABASE_URL, "full"));
  });

  it("hides Prev on the newest Photo and Next on the oldest (clamped)", async () => {
    // On the newest: no Prev, but Next is available.
    const { unmount } = renderViewer({
      photos: shuffled,
      initialPhotoIndex: shuffled.indexOf(newest),
    });
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /previous/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /next/i })).toBeTruthy();
    unmount();

    // On the oldest: no Next, but Prev is available.
    renderViewer({ photos: shuffled, initialPhotoIndex: shuffled.indexOf(oldest) });
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /next/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /previous/i })).toBeTruthy();
  });
});

describe("PhotoViewer — zoom", () => {
  // jsdom gives every element a 0×0 rect; the zoom math needs a real viewport.
  // Stub a 1000×800 surface (origin 0,0) so focal points equal clientX/clientY,
  // and size the Photo 4000×3000 so fit spans the full width (fitW = 1000).
  let rectSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1000,
      height: 800,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => rectSpy.mockRestore());

  const zoomPhoto = (overrides: Partial<Photo> = {}) =>
    makePhoto({ width: 4000, height: 3000, ...overrides });

  const img = () => screen.getByRole("img") as HTMLImageElement;
  // The applied magnification, parsed out of the CSS transform on the image.
  const scaleOf = (el: HTMLElement) => {
    const m = /scale\(([\d.]+)\)/.exec(el.style.transform);
    return m ? parseFloat(m[1]) : 1;
  };
  // The horizontal pan offset, parsed out of the CSS transform's translate().
  const offsetXOf = (el: HTMLElement) => {
    const m = /translate\((-?[\d.]+)px/.exec(el.style.transform);
    return m ? parseFloat(m[1]) : 0;
  };
  const src = () => img().getAttribute("src");
  const zoomIn = async () =>
    act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /zoom in/i }));
    });

  it("magnifies the Photo when the ＋ (zoom in) button is pressed", async () => {
    renderViewer({ photos: [zoomPhoto()] });
    await act(async () => {});
    expect(scaleOf(img())).toBe(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /zoom in/i }));
    });

    expect(scaleOf(img())).toBeGreaterThan(1);
  });

  it("− (zoom out) is disabled at fit and brings a zoomed Photo back", async () => {
    renderViewer({ photos: [zoomPhoto()] });
    await act(async () => {});

    const zoomOut = () => screen.getByRole("button", { name: /zoom out/i }) as HTMLButtonElement;
    expect(zoomOut().disabled).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /zoom in/i }));
    });
    expect(zoomOut().disabled).toBe(false);
    const zoomedIn = scaleOf(img());

    await act(async () => {
      fireEvent.click(zoomOut());
    });
    expect(scaleOf(img())).toBeLessThan(zoomedIn);
  });

  it("scroll-wheel up magnifies the Photo", async () => {
    renderViewer({ photos: [zoomPhoto()] });
    await act(async () => {});

    await act(async () => {
      // Negative deltaY = scroll up = zoom in, about the cursor.
      fireEvent.wheel(img(), { deltaY: -200, clientX: 500, clientY: 400 });
    });

    expect(scaleOf(img())).toBeGreaterThan(1);
  });

  it("double-click snaps to zoomed, and again back to fit", async () => {
    renderViewer({ photos: [zoomPhoto()] });
    await act(async () => {});

    await act(async () => {
      fireEvent.doubleClick(img(), { clientX: 500, clientY: 400 });
    });
    expect(scaleOf(img())).toBe(2);

    await act(async () => {
      fireEvent.doubleClick(img(), { clientX: 500, clientY: 400 });
    });
    expect(scaleOf(img())).toBe(1);
  });

  it("resets to fit when paging to another Photo", async () => {
    const a = zoomPhoto({ id: "a", storage_path: "job-1/a.jpg", created_at: "2026-05-02T10:00:00Z" });
    const b = zoomPhoto({ id: "b", storage_path: "job-1/b.jpg", created_at: "2026-05-01T10:00:00Z" });
    renderViewer({ photos: [a, b], initialPhotoIndex: 0 });
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /zoom in/i }));
    });
    expect(scaleOf(img())).toBeGreaterThan(1);

    // Page to the next Photo — it should open at fit, not inherit the zoom.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
    });
    expect(scaleOf(img())).toBe(1);
  });

  it("drags to pan once zoomed, clamped within the image", async () => {
    renderViewer({ photos: [zoomPhoto()] });
    await act(async () => {});
    await zoomIn();
    expect(offsetXOf(img())).toBe(0);

    // Drag left by 100px → the image shifts left (negative offset).
    await act(async () => {
      fireEvent.mouseDown(img(), { clientX: 500, clientY: 400 });
      fireEvent.mouseMove(img(), { clientX: 400, clientY: 400 });
      fireEvent.mouseUp(img(), { clientX: 400, clientY: 400 });
    });

    expect(offsetXOf(img())).toBeLessThan(0);
  });

  it("does not pan at fit (a stray drag leaves the image centred)", async () => {
    renderViewer({ photos: [zoomPhoto()] });
    await act(async () => {});

    await act(async () => {
      fireEvent.mouseDown(img(), { clientX: 500, clientY: 400 });
      fireEvent.mouseMove(img(), { clientX: 300, clientY: 400 });
      fireEvent.mouseUp(img(), { clientX: 300, clientY: 400 });
    });

    expect(offsetXOf(img())).toBe(0);
  });

  it("suppresses swipe navigation while zoomed (the drag pans instead)", async () => {
    const a = zoomPhoto({ id: "a", storage_path: "job-1/a.jpg", created_at: "2026-05-02T10:00:00Z" });
    const b = zoomPhoto({ id: "b", storage_path: "job-1/b.jpg", created_at: "2026-05-01T10:00:00Z" });
    renderViewer({ photos: [a, b], initialPhotoIndex: 0 });
    await act(async () => {});
    await zoomIn();
    const before = src();

    // A leftward one-finger swipe that would normally advance a Photo.
    await act(async () => {
      fireEvent.touchStart(img(), { touches: [{ clientX: 240, clientY: 400 }] });
      fireEvent.touchEnd(img(), { changedTouches: [{ clientX: 80, clientY: 400 }] });
    });

    // Still on the same Photo — paging was suppressed.
    expect(src()).toBe(before);
  });

  it("pinching two fingers apart magnifies the Photo", async () => {
    renderViewer({ photos: [zoomPhoto()] });
    await act(async () => {});

    await act(async () => {
      // Two fingers 40px apart, then spread to 200px apart (5×), centred.
      fireEvent.touchStart(img(), {
        touches: [
          { clientX: 480, clientY: 400 },
          { clientX: 520, clientY: 400 },
        ],
      });
      fireEvent.touchMove(img(), {
        touches: [
          { clientX: 400, clientY: 400 },
          { clientX: 600, clientY: 400 },
        ],
      });
      fireEvent.touchEnd(img(), { changedTouches: [{ clientX: 400, clientY: 400 }] });
    });

    expect(scaleOf(img())).toBeGreaterThan(1);
  });

  it("double-tap (touch) snaps to zoomed", async () => {
    renderViewer({ photos: [zoomPhoto()] });
    await act(async () => {});

    const tap = () =>
      act(async () => {
        fireEvent.touchStart(img(), { touches: [{ clientX: 500, clientY: 400 }] });
        fireEvent.touchEnd(img(), { changedTouches: [{ clientX: 500, clientY: 400 }] });
      });

    await tap();
    await tap();

    expect(scaleOf(img())).toBe(2);
  });

  it("one-finger drag pans once zoomed (touch)", async () => {
    renderViewer({ photos: [zoomPhoto()] });
    await act(async () => {});
    await zoomIn();

    await act(async () => {
      fireEvent.touchStart(img(), { touches: [{ clientX: 500, clientY: 400 }] });
      fireEvent.touchMove(img(), { touches: [{ clientX: 400, clientY: 400 }] });
      fireEvent.touchEnd(img(), { changedTouches: [{ clientX: 400, clientY: 400 }] });
    });

    expect(offsetXOf(img())).toBeLessThan(0);
  });

  it("ignores a pinch on a video (Zoom doesn't apply)", async () => {
    // A video plays inline via a <video>, not the zoomable <img>; the pinch
    // gesture bubbles to the same surface but Zoom is disabled for video.
    const { container } = renderViewer({
      photos: [zoomPhoto({ media_type: "video" })],
    });
    await act(async () => {});
    const video = container.querySelector("video") as HTMLVideoElement;

    await act(async () => {
      fireEvent.touchStart(video, {
        touches: [
          { clientX: 480, clientY: 400 },
          { clientX: 520, clientY: 400 },
        ],
      });
      fireEvent.touchMove(video, {
        touches: [
          { clientX: 400, clientY: 400 },
          { clientX: 600, clientY: 400 },
        ],
      });
      fireEvent.touchEnd(video, { changedTouches: [{ clientX: 400, clientY: 400 }] });
    });

    // The video carries no zoom transform — the pinch was ignored.
    expect(scaleOf(video)).toBe(1);
  });
});

describe("PhotoViewer — media capabilities (video hides Zoom & Draw)", () => {
  const video = () =>
    makePhoto({ media_type: "video", storage_path: "job-1/clip.mp4" });

  it("hides the Zoom controls for a video", async () => {
    renderViewer({ photos: [video()] });
    await act(async () => {});

    expect(screen.queryByRole("button", { name: /zoom in/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /zoom out/i })).toBeNull();
  });

  it("hides the Edit (Draw) action for a video", async () => {
    renderViewer({ photos: [video()] });
    await act(async () => {});

    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
  });

  it("still offers Zoom and Edit for a still photo", async () => {
    renderViewer();
    await act(async () => {});

    expect(screen.queryByRole("button", { name: /zoom in/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeTruthy();
  });
});

describe("PhotoViewer — video playback", () => {
  const video = (overrides: Partial<Photo> = {}) =>
    makePhoto({ media_type: "video", storage_path: "job-1/clip.mp4", ...overrides });

  it("plays a video inline with a scrub bar (a <video controls> at the source)", async () => {
    const photo = video();
    const { container } = renderViewer({ photos: [photo] });
    await act(async () => {});

    const el = container.querySelector("video") as HTMLVideoElement | null;
    expect(el).toBeTruthy();
    // Native controls give the inline scrub bar.
    expect(el!.hasAttribute("controls")).toBe(true);
    // Loads the resolved media source (ADR 0008 routing).
    expect(el!.getAttribute("src")).toBe(photoUrl(photo, SUPABASE_URL, "full"));
  });

  it("renders the video element instead of a still <img>", async () => {
    const { container } = renderViewer({ photos: [video()] });
    await act(async () => {});

    expect(container.querySelector("video")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("prev/next page across a video — it isn't special-cased out of navigation", async () => {
    const vid = video({ id: "vid", created_at: "2026-05-02T10:00:00Z" });
    const still = makePhoto({
      id: "still",
      storage_path: "job-1/still.jpg",
      created_at: "2026-05-01T10:00:00Z",
    });
    // Newest-first ordering opens on the video; Next pages to the older still.
    const { container } = renderViewer({
      photos: [vid, still],
      initialPhotoIndex: 0,
    });
    await act(async () => {});
    expect(container.querySelector("video")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
    });
    // Advanced to the still: the <img> shows, the <video> is gone.
    expect(container.querySelector("video")).toBeNull();
    expect(
      (screen.getByRole("img") as HTMLImageElement).getAttribute("src"),
    ).toBe(photoUrl(still, SUPABASE_URL, "full"));

    // Prev returns to the video.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /previous/i }));
    });
    expect(container.querySelector("video")).toBeTruthy();
  });
});

describe("PhotoViewer — guard", () => {
  it("renders nothing when closed", () => {
    const { container } = renderViewer({ open: false });
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when there is no photo at the index", () => {
    const { container } = renderViewer({ photos: [], initialPhotoIndex: 0 });
    expect(container.firstChild).toBeNull();
  });
});

// Issue #520 — the phone layout. On a phone viewport the Photo is full-bleed and
// the desktop side panel is gone; a top bar carries ✕ / Job name / ⓘ, the
// uploader·date·caption sit inline at the bottom, and a bottom action row raises
// a per-button safe-area-aware slide-up panel. The viewer chooses the layout at
// runtime from the viewport width (jsdom defaults to 1024 → desktop), so these
// tests force a phone-class width before rendering and restore it afterward.
describe("PhotoViewer — phone layout", () => {
  const ORIGINAL_WIDTH = window.innerWidth;
  const ORIGINAL_HEIGHT = window.innerHeight;
  function setViewport(width: number, height: number) {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
  }
  beforeEach(() => setViewport(390, 844)); // iPhone-class portrait
  afterEach(() => setViewport(ORIGINAL_WIDTH, ORIGINAL_HEIGHT));

  it("renders a full-bleed Photo without the desktop side panel", async () => {
    renderViewer();
    await act(async () => {});

    // The Photo still renders…
    expect(screen.getByRole("img")).toBeTruthy();
    // …but the desktop side panel's "Save Changes" is gone — phone persists each
    // change from its own slide-up panel, not a single side-panel Save.
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
  });

  it("shows a top bar with a close ✕, the Job name, and an info button", async () => {
    renderViewer({ jobName: "Eleanor Whitfield" });
    await act(async () => {});

    expect(screen.getByRole("button", { name: /close/i })).toBeTruthy();
    expect(screen.getByText("Eleanor Whitfield")).toBeTruthy();
    expect(screen.getByRole("button", { name: /details/i })).toBeTruthy();
  });

  it("closes back to the Job when the top-bar ✕ is tapped", async () => {
    const { onOpenChange } = renderViewer();
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /close/i }));
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the Photo's assigned tags as view-only pills on the Photo", async () => {
    h.tagAssignments = [{ tag_id: "tag-a" }];
    renderViewer({
      allTags: [makeTag("tag-a", "Roof"), makeTag("tag-b", "Water")],
    });
    // Let the mount-effect tag read resolve.
    await act(async () => {});

    // The assigned tag shows as a pill on the Photo…
    expect(screen.getByText("Roof")).toBeTruthy();
    // …view-only — it is not an interactive button (editing is in the Tags
    // panel, so swiping never toggles a tag by accident).
    expect(screen.queryByRole("button", { name: "Roof" })).toBeNull();
    // …and an unassigned tag is not shown on the Photo.
    expect(screen.queryByText("Water")).toBeNull();
  });

  it("shows the uploader, date, and caption inline along the bottom", async () => {
    renderViewer({
      photos: [
        makePhoto({
          taken_by: "Eric Daniels",
          caption: "Roof damage to NE corner",
        }),
      ],
    });
    await act(async () => {});

    expect(screen.getByText(/Eric Daniels/)).toBeTruthy();
    // Date is shown; assert the year (timezone-stable, unlike day/hour).
    expect(screen.getByText(/2026/)).toBeTruthy();
    expect(screen.getByText(/Roof damage to NE corner/)).toBeTruthy();
  });

  it("shows a bottom action row — Tags, Draw, Before/After, and ⋯ More", async () => {
    renderViewer();
    await act(async () => {});

    expect(screen.getByRole("button", { name: /^tags$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^draw$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /before.*after/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /more/i })).toBeTruthy();
  });

  it("hides Draw for a video in the bottom action row (no still to draw on)", async () => {
    renderViewer({
      photos: [makePhoto({ media_type: "video", storage_path: "job-1/clip.mp4" })],
    });
    await act(async () => {});

    expect(screen.queryByRole("button", { name: /^draw$/i })).toBeNull();
    // The other actions still apply to a video.
    expect(screen.getByRole("button", { name: /^tags$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /before.*after/i })).toBeTruthy();
  });

  it("Draw hands the still off to the Annotator with its display URL", async () => {
    const { photo, onAnnotate } = renderViewer();
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^draw$/i }));
    });

    expect(onAnnotate).toHaveBeenCalledWith(
      photo,
      photoUrl(photo, SUPABASE_URL, "full"),
    );
  });

  it("raises the Tags add/remove list when Tags is tapped", async () => {
    renderViewer({
      allTags: [makeTag("tag-a", "Roof"), makeTag("tag-b", "Water")],
    });
    await act(async () => {});

    // Closed: the interactive tag toggles aren't on screen yet.
    expect(screen.queryByRole("button", { name: "Roof" })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^tags$/i }));
    });

    // The panel raises the add/remove list — each tag becomes a toggle.
    expect(screen.getByRole("button", { name: "Roof" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Water" })).toBeTruthy();
  });

  it("pre-selects the Photo's existing tags in the Tags panel", async () => {
    h.tagAssignments = [{ tag_id: "tag-a" }];
    renderViewer({
      allTags: [makeTag("tag-a", "Roof"), makeTag("tag-b", "Water")],
    });
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^tags$/i }));
    });

    const selected = screen.getByRole("button", { name: "Roof" }) as HTMLElement;
    const unselected = screen.getByRole("button", { name: "Water" }) as HTMLElement;
    expect(selected.style.backgroundColor).toBeTruthy();
    expect(unselected.style.backgroundColor).toBeFalsy();
  });

  it("adds/removes tags from the Tags panel and persists on Done", async () => {
    const { photo } = renderViewer({
      allTags: [makeTag("tag-a", "Roof"), makeTag("tag-b", "Water")],
    });
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^tags$/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Roof" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    });

    // Persisted with the same delete-all-then-insert the desktop Save uses.
    expect(h.del).toHaveBeenCalledWith(
      "photo_tag_assignments",
      "photo_id",
      photo.id,
    );
    expect(h.insert).toHaveBeenCalledWith(
      "photo_tag_assignments",
      expect.arrayContaining([
        expect.objectContaining({
          organization_id: "org-1",
          photo_id: photo.id,
          tag_id: "tag-a",
        }),
      ]),
    );
  });

  it("raises the Before/After toggle when Before/After is tapped", async () => {
    renderViewer();
    await act(async () => {});

    // Closed: the role toggles aren't on screen.
    expect(screen.queryByRole("button", { name: "After" })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /before.*after/i }));
    });

    expect(screen.getByRole("button", { name: "Before" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "After" })).toBeTruthy();
  });

  it("sets the Before/After role from the panel and persists on Done", async () => {
    renderViewer();
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /before.*after/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "After" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    });

    expect(h.update).toHaveBeenCalledWith(
      "photos",
      expect.objectContaining({ before_after_role: "after" }),
    );
  });

  it("clears the Before/After role from the panel and persists on Done", async () => {
    renderViewer({ photos: [makePhoto({ before_after_role: "before" })] });
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /before.*after/i }));
    });
    // Toggling the active role off clears it.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Before" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    });

    expect(h.update).toHaveBeenCalledWith(
      "photos",
      expect.objectContaining({ before_after_role: null }),
    );
  });

  it("offers Share, Duplicate, Set as cover, Save to device, and Delete in ⋯ More", async () => {
    renderViewer();
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /more/i }));
    });

    expect(screen.getByRole("button", { name: /share/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /duplicate/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /set as cover/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /save to device/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeTruthy();
  });

  it("Set as cover from ⋯ More writes the Job's cover to the current Photo", async () => {
    const { photo } = renderViewer();
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /more/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /set as cover/i }));
    });

    expect(h.update).toHaveBeenCalledWith(
      "jobs",
      expect.objectContaining({ cover_photo_id: photo.id }),
    );
  });

  it("Delete from ⋯ More confirms, then closes on the last Photo", async () => {
    const { onOpenChange } = renderViewer();
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /more/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    });
    // Arming Delete does not delete yet — it asks to confirm.
    expect(h.del).not.toHaveBeenCalledWith("photos", "id", expect.anything());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    });

    // Deleting the only Photo closes the viewer (deferred hard delete + Undo).
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast).toHaveBeenCalledWith(
      expect.stringMatching(/deleted/i),
      expect.objectContaining({
        action: expect.objectContaining({ label: expect.stringMatching(/undo/i) }),
      }),
    );
  });

  it("raises a details panel from the info (ⓘ) button with the file size", async () => {
    renderViewer({
      photos: [makePhoto({ taken_by: "Eric Daniels", file_size: 2_097_152 })],
    });
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /details/i }));
    });

    // The info panel carries the fuller metadata — the file size, which the
    // inline bottom strip omits.
    expect(screen.getByText(/2\.0 MB/)).toBeTruthy();
  });

  it("offers Restore Original in the info panel for an annotated Photo", async () => {
    renderViewer({
      photos: [makePhoto({ annotated_path: "job-1/p1-annotated.png" })],
    });
    // Let the mount-effect backup probe resolve so the control appears.
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /details/i }));
    });

    expect(
      screen.getByRole("button", { name: /restore original/i }),
    ).toBeTruthy();
  });

  it("pads its slide-up panels past the iOS safe-area inset", async () => {
    renderViewer({
      allTags: [makeTag("tag-a", "Roof")],
    });
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^tags$/i }));
    });

    // The open panel's scroll area pads its bottom past the home indicator.
    const panel = screen.getByRole("dialog");
    expect(
      panel.querySelector('[class*="safe-area-inset-bottom"]'),
    ).toBeTruthy();
  });

  it("pages between Photos on swipe", async () => {
    const a = makePhoto({
      id: "a",
      storage_path: "job-1/a.jpg",
      created_at: "2026-05-02T10:00:00Z",
    });
    const b = makePhoto({
      id: "b",
      storage_path: "job-1/b.jpg",
      created_at: "2026-05-01T10:00:00Z",
    });
    renderViewer({ photos: [a, b], initialPhotoIndex: 0 });
    await act(async () => {});

    const src = () =>
      (screen.getByRole("img") as HTMLImageElement).getAttribute("src");
    const surface = screen.getByRole("img").parentElement as HTMLElement;
    expect(src()).toBe(photoUrl(a, SUPABASE_URL, "full"));

    // Finger travels right → left: advance to the next (older) Photo.
    await act(async () => {
      fireEvent.touchStart(surface, { touches: [{ clientX: 240 }] });
      fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 80 }] });
    });
    expect(src()).toBe(photoUrl(b, SUPABASE_URL, "full"));
  });

  it("drops the desktop zoom buttons on a phone (pinch-to-zoom replaces them)", async () => {
    renderViewer();
    await act(async () => {});

    // The full-bleed phone surface zooms by pinch / double-tap, so the on-photo
    // ＋ / − buttons (which would overlap the bottom action row) are not shown.
    expect(screen.queryByRole("button", { name: /zoom in/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /zoom out/i })).toBeNull();
  });
});
