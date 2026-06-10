// All-Photos page — grid thumbnails go through the Photo URL resolver (#418).
//
// The all-Photos grid used to hand-build the full-resolution object URL for
// every square (the same full-res-in-a-thumbnail problem #392 fixed for the
// Job Photos grid). These tests mount the page and assert the grid <img> src
// is whatever photoUrl(photo, supabaseUrl, "grid") resolves to: a resized
// render/image preview when the resize flag is on, the untouched original when
// it's off (ADR 0008).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(),
}));

import PhotosPage from "./page";
import { createClient } from "@/lib/supabase";

const SUPABASE_URL = "https://proj.supabase.co";

type Row = Record<string, unknown>;

// Minimal thenable query builder: the page only chains .select().order() and
// then awaits the result, reading `.data`.
function fakeQueryBuilder(rows: Row[]) {
  const builder = {
    select: () => builder,
    order: () => builder,
    then(resolve: (v: { data: Row[]; error: null }) => unknown) {
      return resolve({ data: rows, error: null });
    },
  };
  return builder;
}

function useTables(tables: Record<string, Row[]>) {
  vi.mocked(createClient).mockReturnValue({
    from(table: string) {
      return fakeQueryBuilder(tables[table] ?? []);
    },
  } as never);
}

function photoRow(overrides: Row = {}): Row {
  return {
    id: "p-1",
    job_id: "j-1",
    annotated_path: null,
    storage_path: "originals/abc.jpg",
    caption: "Kitchen before",
    before_after_role: null,
    created_at: "2026-05-01T00:00:00Z",
    job: { id: "j-1", job_number: "J-100", property_address: "1 Main St" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
});

afterEach(() => vi.unstubAllEnvs());

describe("/photos — grid thumbnails request the grid variant (#418)", () => {
  it("serves a resized render/image preview when the resize flag is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTO_RESIZE_ENABLED", "true");
    useTables({ photos: [photoRow()], photo_tags: [], jobs: [] });

    render(<PhotosPage />);

    const img = (await screen.findByAltText("Kitchen before")) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(
      "https://proj.supabase.co/storage/v1/render/image/public/photos/originals/abc.jpg?width=400&height=400&quality=60&resize=cover",
    );
  });

  it("serves the untouched original when the resize flag is off (no change vs today)", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTO_RESIZE_ENABLED", "");
    useTables({ photos: [photoRow()], photo_tags: [], jobs: [] });

    render(<PhotosPage />);

    const img = (await screen.findByAltText("Kitchen before")) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(
      "https://proj.supabase.co/storage/v1/object/public/photos/originals/abc.jpg",
    );
  });

  it("previews the annotated copy when a photo has one (resize on)", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTO_RESIZE_ENABLED", "true");
    useTables({
      photos: [photoRow({ annotated_path: "annotated/abc.jpg" })],
      photo_tags: [],
      jobs: [],
    });

    render(<PhotosPage />);

    const img = (await screen.findByAltText("Kitchen before")) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(
      "https://proj.supabase.co/storage/v1/render/image/public/photos/annotated/abc.jpg?width=400&height=400&quality=60&resize=cover",
    );
  });
});
