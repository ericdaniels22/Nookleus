// Issue #551 — per-report Cover Page editor.
//
// Behavior of the Cover Page editor surfaced in the builder's center pane when
// the pinned Cover Page rail row is selected. Driven through the DOM: the cover
// photo picker (choose one of the Job's photos), the five identifying-block
// toggles (logo, customer, property address, point of contact, insurance), and
// the "freeze on first edit" persistence — the report materializes its own copy
// of the resolved cover (Job-cover fallback included) on the first autosave.
// Mirrors the harness in photo-report-builder.test.tsx but adds the
// `jobCoverPhotoId` prop the cover seed resolves through.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

import type { Photo, PhotoReport } from "@/lib/types";

// Capture the Supabase write payload so a test can assert what autosave persists.
const h = vi.hoisted(() => ({
  updateMock: vi.fn<(payload: Record<string, unknown>) => void>(),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        h.updateMock(payload);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/generate-report-pdf", () => ({
  generateReportPDF: vi.fn(async () => "job-1/report-1.pdf"),
}));

vi.mock("@/components/tiptap-editor", () => ({
  default: ({
    content,
    onChange,
  }: {
    content: string;
    onChange: (html: string) => void;
  }) => (
    <textarea
      data-testid="tiptap-stub"
      aria-label="Section write-up"
      defaultValue={content}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

// A passthrough DndContext — the cover editor never drags, and the sortable
// hooks tolerate the absent provider and render fine.
vi.mock("@dnd-kit/core", async () => {
  const actual =
    await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import React from "react";
import PhotoReportBuilder from "./photo-report-builder";

function makeReport(overrides: Partial<PhotoReport> = {}): PhotoReport {
  return {
    id: "report-1",
    organization_id: "org-1",
    job_id: "job-1",
    template_id: null,
    title: "Photo Report #1",
    report_number: 1,
    report_date: "2026-06-04",
    sections: [{ title: "Photos", description: "", photo_ids: ["p1"] }],
    pdf_path: null,
    status: "draft",
    created_by: "Eric Daniels",
    created_at: "2026-06-04T00:00:00Z",
    updated_at: "2026-06-04T00:00:00Z",
    deleted_at: null,
    report_settings: null,
    cover_config: null,
    cover_photo_id: null,
    ...overrides,
  };
}

function makePhoto(id: string, caption: string | null = null): Photo {
  return {
    id,
    storage_path: `job-1/${id}.jpg`,
    annotated_path: null,
    caption,
  } as Photo;
}

function renderBuilder(
  report = makeReport(),
  photos: Photo[] = [],
  jobCoverPhotoId: string | null = null,
) {
  return render(
    <PhotoReportBuilder
      jobId="job-1"
      report={report}
      photos={photos}
      supabaseUrl="https://example.supabase.co"
      jobCoverPhotoId={jobCoverPhotoId}
    />,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
  h.updateMock.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Cover Page editor — freeze on first edit (#551)", () => {
  it("autosaves the resolved cover (Job-cover fallback + all blocks on) on the first edit", async () => {
    // The report owns no cover yet, but the Job has a cover photo. Editing the
    // title materializes the report's own cover snapshot: the Job's cover photo
    // and every identifying block on (ADR 0014 "freeze on first edit").
    renderBuilder(makeReport(), [makePhoto("job-cover-9")], "job-cover-9");

    const titleInput = screen.getByLabelText("Report title");
    act(() => {
      fireEvent.change(titleInput, { target: { value: "Roof inspection" } });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(h.updateMock).toHaveBeenCalledTimes(1);
    const payload = h.updateMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      title: "Roof inspection",
      cover_photo_id: "job-cover-9",
      cover_config: {
        logo: true,
        customer: true,
        propertyAddress: true,
        pointOfContact: true,
        insurance: true,
      },
    });
  });

  it("flushes the cover columns on unmount before the debounce fires", async () => {
    // Leaving the builder (in-app unmount) within the 2s debounce window must
    // not drop the cover snapshot: the keepalive PUT carries it too, identical
    // to the debounced write.
    const { unmount } = renderBuilder(
      makeReport(),
      [makePhoto("job-cover-9")],
      "job-cover-9",
    );

    const titleInput = screen.getByLabelText("Report title");
    act(() => {
      fireEvent.change(titleInput, { target: { value: "Roof inspection" } });
    });

    // Unmount before the debounce elapses — the Supabase write never fires.
    act(() => {
      unmount();
    });
    expect(h.updateMock).not.toHaveBeenCalled();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).keepalive).toBe(true);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      title: "Roof inspection",
      cover_photo_id: "job-cover-9",
      cover_config: {
        logo: true,
        customer: true,
        propertyAddress: true,
        pointOfContact: true,
        insurance: true,
      },
    });
  });
});

describe("Cover Page editor — choosing a cover photo (#551)", () => {
  it("persists the photo the author picks, overriding the Job-cover fallback", async () => {
    renderBuilder(
      makeReport(),
      [makePhoto("job-cover-9", "Front"), makePhoto("p2", "Back")],
      "job-cover-9",
    );

    // Pick the second photo as the cover, away from the Job's default.
    const option = screen.getByRole("button", {
      name: /Back.*cover/i,
    });
    act(() => {
      fireEvent.click(option);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(h.updateMock).toHaveBeenCalledTimes(1);
    expect(h.updateMock.mock.calls[0][0]).toMatchObject({
      cover_photo_id: "p2",
    });
  });
});

describe("Cover Page editor — block toggles (#551)", () => {
  it("offers every identifying block, all on by default", () => {
    renderBuilder();

    for (const label of [
      "Logo",
      "Customer",
      "Property address",
      "Point of contact",
      "Insurance",
    ]) {
      const toggle = screen.getByRole("checkbox", { name: label });
      expect((toggle as HTMLInputElement).checked).toBe(true);
    }
  });

  it("persists a block switched off, leaving the others on", async () => {
    renderBuilder();

    const insurance = screen.getByRole("checkbox", { name: "Insurance" });
    act(() => {
      fireEvent.click(insurance);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(h.updateMock).toHaveBeenCalledTimes(1);
    expect(h.updateMock.mock.calls[0][0]).toMatchObject({
      cover_config: {
        logo: true,
        customer: true,
        propertyAddress: true,
        pointOfContact: true,
        insurance: false,
      },
    });
  });
});

describe("Cover Page editor — seeded cover selection (#551)", () => {
  it("defaults the cover to the Job's cover photo when the report has none", () => {
    renderBuilder(
      makeReport({ cover_photo_id: null }),
      [makePhoto("job-cover-9", "Front"), makePhoto("p2", "Back")],
      "job-cover-9",
    );

    // The Job's cover photo shows pre-selected, with no edit needed.
    expect(
      screen
        .getByRole("button", { name: /Front.*cover/i })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: /Back.*cover/i })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("prefers the report's own cover photo over the Job's", () => {
    renderBuilder(
      makeReport({ cover_photo_id: "p2" }),
      [makePhoto("job-cover-9", "Front"), makePhoto("p2", "Back")],
      "job-cover-9",
    );

    expect(
      screen
        .getByRole("button", { name: /Back.*cover/i })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: /Front.*cover/i })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("seeds the block toggles from the report's own cover_config snapshot", () => {
    renderBuilder(makeReport({ cover_config: { insurance: false } }));

    expect(
      (screen.getByRole("checkbox", { name: "Insurance" }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(
      (screen.getByRole("checkbox", { name: "Customer" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
});
