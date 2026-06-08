// Issue: the only entry point to a Photo Report was the bulk-action bar's
// "Create report", which renders only after photos are selected — so with
// nothing selected there was no visible way to start a report. This adds an
// always-visible "New report" toolbar button that starts a blank report, while
// keeping the selection flow that pre-fills the chosen photos. These tests drive
// both paths through the DOM, mocking the Supabase client (photo + template
// reads), next/navigation, sonner, the upload modal, and global fetch.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import React from "react";

import type { Photo } from "@/lib/types";

// Hoisted, per-test-configurable backing data for the mocked Supabase reads and
// a stable router.push spy (a fresh vi.fn() per useRouter call could not be
// asserted on).
const h = vi.hoisted(() => ({
  photos: [] as unknown[],
  templates: [] as unknown[],
  push: vi.fn(),
}));

// A chainable, awaitable stand-in for the Supabase query builder. Every method
// returns the same object; awaiting it (the component awaits `.range()` for
// photos and `.order()` for templates) resolves to the configured result.
vi.mock("@/lib/supabase", () => {
  const make = (result: unknown) => {
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      order: () => q,
      range: () => q,
      gte: () => q,
      lte: () => q,
      in: () => q,
      update: () => q,
      then: (onF: (r: unknown) => unknown) => onF(result),
    };
    return q;
  };
  return {
    createClient: () => ({
      from: (table: string) => {
        if (table === "photos") return make({ data: h.photos });
        if (table === "photo_report_templates")
          return make({ data: h.templates });
        return make({ data: null, error: null });
      },
    }),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The upload modal is heavy and irrelevant here; stub it inert.
vi.mock("@/components/photo-upload", () => ({ default: () => null }));

import JobPhotosTab from "./job-photos-tab";

// jsdom has no IntersectionObserver (the tab uses one for infinite scroll).
class IO {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

let fetchMock: ReturnType<typeof vi.fn>;

function makePhoto(id: string): Photo {
  return {
    id,
    job_id: "job-1",
    storage_path: `job-1/${id}.jpg`,
    annotated_path: null,
    caption: null,
    taken_by: "Eric Daniels",
    before_after_role: null,
    created_at: "2026-06-04T12:00:00Z",
  } as Photo;
}

function renderTab() {
  return render(
    <JobPhotosTab
      jobId="job-1"
      tags={[]}
      supabaseUrl="https://example.supabase.co"
      coverPhotoId={null}
      onPhotosAdded={() => {}}
      onPhotoUpdated={() => {}}
      onCoverPhotoChanged={() => {}}
      onSelectPhoto={() => {}}
    />,
  );
}

function reportsPostCall() {
  return fetchMock.mock.calls.find(
    (c) => c[0] === "/api/jobs/job-1/reports",
  );
}

describe("JobPhotosTab — New report entry point", () => {
  beforeEach(() => {
    h.photos = [];
    h.templates = [];
    h.push.mockClear();
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ report: { id: "new-report-1" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", IO);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows an always-visible New report button even with no photos selected", async () => {
    renderTab();
    // The toolbar button is present before any selection…
    expect(
      await screen.findByRole("button", { name: /new report/i }),
    ).toBeTruthy();
    // …whereas the selection-only "Create report" is absent until photos are picked.
    expect(
      screen.queryByRole("button", { name: /create report/i }),
    ).toBeNull();
  });

  it("starts a blank report from the toolbar: POSTs empty photoIds and opens the builder", async () => {
    renderTab();
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: /new report/i }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Blank report"));
    });

    const call = reportsPostCall();
    expect(call).toBeTruthy();
    const body = JSON.parse(call![1].body as string);
    expect(body.photoIds).toEqual([]);
    expect(body.templateId).toBeUndefined();
    expect(h.push).toHaveBeenCalledWith("/jobs/job-1/reports/new-report-1");
  });

  it("starts from a template via the toolbar: POSTs that templateId with empty photoIds", async () => {
    h.templates = [{ id: "tmpl-1", name: "Roof Inspection" }];
    renderTab();
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: /new report/i }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Roof Inspection"));
    });

    const call = reportsPostCall();
    expect(call).toBeTruthy();
    const body = JSON.parse(call![1].body as string);
    expect(body.templateId).toBe("tmpl-1");
    expect(body.photoIds).toEqual([]);
    expect(h.push).toHaveBeenCalledWith("/jobs/job-1/reports/new-report-1");
  });

  it("still pre-fills the selected photos from the bulk bar's Create report", async () => {
    h.photos = [makePhoto("p1")];
    renderTab();

    // Right-click a photo to start a selection (a plain click opens the photo).
    const img = await screen.findByRole("img");
    act(() => {
      fireEvent.contextMenu(img);
    });

    // The bulk bar now offers "Create report"; open its menu and pick Blank.
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /create report/i }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Blank report"));
    });

    const call = reportsPostCall();
    expect(call).toBeTruthy();
    const body = JSON.parse(call![1].body as string);
    expect(body.photoIds).toEqual(["p1"]);
    expect(h.push).toHaveBeenCalledWith("/jobs/job-1/reports/new-report-1");
  });
});
