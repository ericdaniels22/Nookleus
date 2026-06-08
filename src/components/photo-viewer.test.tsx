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

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
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

  it("Confirming Delete hard-deletes the Photo and closes the viewer", async () => {
    const { photo, onUpdated, onOpenChange } = renderViewer();
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    });

    expect(h.remove).toHaveBeenCalledWith("photos", [photo.storage_path]);
    expect(h.del).toHaveBeenCalledWith("photos", "id", photo.id);
    expect(onUpdated).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
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
