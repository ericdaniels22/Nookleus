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

import { format } from "date-fns";

import type { Photo } from "@/lib/types";
import { toast } from "sonner";

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

  it("surfaces an error and resets the button when creating a report fails", async () => {
    vi.mocked(toast.error).mockClear();
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    renderTab();

    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: /new report/i }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Blank report"));
    });

    // The failed POST surfaces a toast and does not navigate…
    expect(reportsPostCall()).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith("Failed to create report.");
    expect(h.push).not.toHaveBeenCalled();
    // …and the button resets to its idle label, not stuck on "Creating…".
    expect(screen.getByRole("button", { name: /new report/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /creating/i })).toBeNull();
  });

  it("opening one Start-from menu closes the other", async () => {
    h.photos = [makePhoto("p1")];
    renderTab();

    // Right-click a photo so the bulk bar (with "Create report") appears.
    const img = await screen.findByRole("img");
    act(() => {
      fireEvent.contextMenu(img);
    });

    // Open the bulk bar's menu — exactly one "Start from…" popover is open.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create report/i }));
    });
    expect(screen.getAllByText("Start from…")).toHaveLength(1);

    // Opening the toolbar's menu must close the bulk one, never two at once.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /new report/i }));
    });
    expect(screen.getAllByText("Start from…")).toHaveLength(1);
  });

  it("locks the in-flight state: one POST, button disabled and relabeled, menu closed", async () => {
    // The anti-double-submit contract. With a create still in flight (a POST that
    // never resolves), the user must have no second way to fire another: the
    // button is disabled and shows "Creating…", the Start-from menu has closed so
    // "Blank report" is gone, and exactly one report POST has been sent. This
    // pins the observable guarantee that selection-free creates can't be
    // double-submitted (button-disable + menu-close, with the creatingReport
    // guard at job-photos-tab.tsx:301 as belt-and-suspenders behind them).
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(() =>
      pending.then(() => ({
        ok: true,
        status: 201,
        json: async () => ({ report: { id: "new-report-1" } }),
      })),
    );

    renderTab();
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: /new report/i }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Blank report"));
    });

    // The in-flight button is disabled and shows the working label…
    const creating = screen.getByRole("button", {
      name: /creating/i,
    }) as HTMLButtonElement;
    expect(creating.disabled).toBe(true);
    // …the Start-from menu has closed (no second "Blank report" to click)…
    expect(screen.queryByText("Blank report")).toBeNull();
    expect(screen.queryByText("Start from…")).toBeNull();
    // …and exactly one report POST was issued.
    const reportPosts = fetchMock.mock.calls.filter(
      (c) => c[0] === "/api/jobs/job-1/reports",
    );
    expect(reportPosts).toHaveLength(1);

    // Let the in-flight request settle so no act() warning trails the test.
    await act(async () => {
      release();
      await pending;
    });
  });

  it("shows the empty-state hint when there are no templates", async () => {
    // With no templates configured, opening the toolbar's Start-from menu loads
    // the (empty) template list and surfaces the "add them in Settings" hint.
    h.templates = [];
    renderTab();
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: /new report/i }),
      );
    });
    expect(await screen.findByText(/No templates yet/i)).toBeTruthy();
  });
});

describe("JobPhotosTab — tile time caption uses the capture time (#622)", () => {
  beforeEach(() => {
    h.photos = [];
    h.templates = [];
    h.push.mockClear();
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", IO);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  // #622 made taken_at the organizing date: the day-group headers use it, so a
  // tile's time caption must agree with its header — a camera-roll photo taken
  // June 1st but uploaded June 10th reads "June 1st … <capture time>", not the
  // upload time. Expected values are computed with the same date-fns format the
  // component uses, so the assertion holds in any test-runner timezone.
  it("captions the tile with taken_at, not the created_at upload time", async () => {
    const takenAt = "2026-06-01T12:34:00Z";
    const createdAt = "2026-06-10T09:01:00Z";
    h.photos = [{ ...makePhoto("p1"), taken_at: takenAt, created_at: createdAt }];
    renderTab();

    await screen.findByRole("img");
    expect(screen.getByText(format(new Date(takenAt), "h:mm a"))).toBeTruthy();
    expect(screen.queryByText(format(new Date(createdAt), "h:mm a"))).toBeNull();
  });

  it("falls back to created_at for pre-#622 rows with no taken_at", async () => {
    const createdAt = "2026-06-10T09:01:00Z";
    h.photos = [{ ...makePhoto("p1"), taken_at: null, created_at: createdAt }];
    renderTab();

    await screen.findByRole("img");
    expect(screen.getByText(format(new Date(createdAt), "h:mm a"))).toBeTruthy();
  });
});
