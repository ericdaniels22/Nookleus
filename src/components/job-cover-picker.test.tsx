import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import type { Photo } from "@/lib/types";

// The picker loads the job's photos from Supabase on mount. A mutable
// module-level result lets each test seed its own photo list.
let photosResult: { data: unknown; error: unknown } = {
  data: [],
  error: null,
};

// Records the `jobs.cover_photo_id` write the picker issues when a photo
// is chosen, so a test can assert which job and photo it targeted.
let coverUpdate: {
  payload: Record<string, unknown>;
  idColumn: string;
  idValue: string;
} | null = null;

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "jobs") {
        return {
          update: (payload: Record<string, unknown>) => ({
            eq: (idColumn: string, idValue: string) => {
              coverUpdate = { payload, idColumn, idValue };
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      // photos: a chainable query stub whose builder methods return the
      // builder, and .then()-ing it resolves to the seeded photo result.
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order"]) {
        builder[method] = () => builder;
      }
      builder.then = (resolve: (r: unknown) => void) => resolve(photosResult);
      return builder;
    },
  }),
}));

import JobCoverPicker from "./job-cover-picker";

function makePhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: "photo-1",
    job_id: "job-1",
    storage_path: "job-1/original.jpg",
    annotated_path: null,
    caption: null,
    taken_at: null,
    taken_by: "user-1",
    media_type: "photo",
    file_size: null,
    width: null,
    height: null,
    before_after_pair_id: null,
    before_after_role: null,
    created_at: "2026-05-20T00:00:00Z",
    organization_id: "org-1",
    uploaded_from: "web",
    client_capture_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  photosResult = { data: [], error: null };
  coverUpdate = null;
});

afterEach(() => vi.unstubAllEnvs());

describe("JobCoverPicker — photo list (#164)", () => {
  it("renders a choosable option for each of the job's photos", async () => {
    photosResult = {
      data: [
        makePhoto({ id: "p-1", caption: "Front of house" }),
        makePhoto({ id: "p-2", caption: "Water damage" }),
      ],
      error: null,
    };

    render(
      <JobCoverPicker
        jobId="job-1"
        currentCoverPhotoId={null}
        supabaseUrl="https://proj.supabase.co"
        onClose={() => {}}
        onCoverChosen={() => {}}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Front of house" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Water damage" })).toBeDefined();
  });
});

describe("JobCoverPicker — empty state (#164)", () => {
  it("tells the user when the job has no photos to choose from", async () => {
    photosResult = { data: [], error: null };

    render(
      <JobCoverPicker
        jobId="job-1"
        currentCoverPhotoId={null}
        supabaseUrl="https://proj.supabase.co"
        onClose={() => {}}
        onCoverChosen={() => {}}
      />,
    );

    expect(await screen.findByText(/no photos/i)).toBeDefined();
  });
});

describe("JobCoverPicker — current cover marker (#164)", () => {
  it("marks the photo that is already the job's cover", async () => {
    photosResult = {
      data: [
        makePhoto({ id: "p-1", caption: "Kitchen" }),
        makePhoto({ id: "p-2", caption: "Bathroom" }),
      ],
      error: null,
    };

    render(
      <JobCoverPicker
        jobId="job-1"
        currentCoverPhotoId="p-2"
        supabaseUrl="https://proj.supabase.co"
        onClose={() => {}}
        onCoverChosen={() => {}}
      />,
    );

    // Exactly one option — the current cover — carries the marker.
    expect(await screen.findByText("Current cover")).toBeDefined();
    expect(screen.getAllByText("Current cover")).toHaveLength(1);
  });

  it("shows no marker when the job has no cover set yet", async () => {
    photosResult = {
      data: [makePhoto({ id: "p-1", caption: "Kitchen" })],
      error: null,
    };

    render(
      <JobCoverPicker
        jobId="job-1"
        currentCoverPhotoId={null}
        supabaseUrl="https://proj.supabase.co"
        onClose={() => {}}
        onCoverChosen={() => {}}
      />,
    );

    expect(await screen.findByRole("button", { name: "Kitchen" })).toBeDefined();
    expect(screen.queryByText("Current cover")).toBeNull();
  });
});

describe("JobCoverPicker — resized previews (#420)", () => {
  it("requests the grid-variant preview for each cover option when resize is enabled", async () => {
    // Acceptance #1 at the display boundary: the picker grid squares are
    // small previews, so with image transformation on each option's <img>
    // src is the resized render URL rather than the multi-MB original.
    vi.stubEnv("NEXT_PUBLIC_PHOTO_RESIZE_ENABLED", "true");
    photosResult = {
      data: [
        makePhoto({ id: "p-1", caption: "Kitchen", storage_path: "job-1/kitchen.jpg" }),
      ],
      error: null,
    };

    render(
      <JobCoverPicker
        jobId="job-1"
        currentCoverPhotoId={null}
        supabaseUrl="https://proj.supabase.co"
        onClose={() => {}}
        onCoverChosen={() => {}}
      />,
    );

    const option = await screen.findByRole("button", { name: "Kitchen" });
    const img = option.querySelector("img");
    expect(img?.getAttribute("src")).toContain(
      "/storage/v1/render/image/public/photos/",
    );
    expect(img?.getAttribute("src")).toContain("width=400");
  });
});

describe("JobCoverPicker — choosing a cover (#164)", () => {
  it("writes the chosen photo as the job's cover and reports it back", async () => {
    photosResult = {
      data: [makePhoto({ id: "p-9", caption: "Living room" })],
      error: null,
    };
    const onCoverChosen = vi.fn();

    render(
      <JobCoverPicker
        jobId="job-1"
        currentCoverPhotoId={null}
        supabaseUrl="https://proj.supabase.co"
        onClose={() => {}}
        onCoverChosen={onCoverChosen}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Living room" }));

    await waitFor(() => expect(onCoverChosen).toHaveBeenCalledTimes(1));
    // The write set this job's cover_photo_id to the chosen photo.
    expect(coverUpdate).toEqual({
      payload: { cover_photo_id: "p-9" },
      idColumn: "id",
      idValue: "job-1",
    });
    // The chosen photo itself is handed back so the row can update.
    expect(onCoverChosen.mock.calls[0][0].id).toBe("p-9");
  });
});
