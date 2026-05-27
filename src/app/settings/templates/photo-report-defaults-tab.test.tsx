// PRD #326 — Photo Report Rework, Slice 6 (#332).
//
// The photo-report-defaults settings tab used to expose four knobs
// (default template, preparer name, photos-per-page, footer text). Slice 6
// collapses it to a single knob: photos-per-page (1 / 2 / 4, default 2).
//
// AC pinned here:
//   - "The photo-report-defaults settings tab renders only one control:
//      photos-per-page (1, 2, or 4 — default 2)."
//   - "Changing the photos-per-page setting persists to
//      photo_report_defaults.report_photos_per_page and is read back on
//      page reload." — settings live in `company_settings` (key/value),
//      so the PUT body carries only `report_photos_per_page`.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  }),
}));

import { PhotoReportDefaultsTab } from "./photo-report-defaults-tab";

function stubFetch(opts: {
  settings?: Record<string, string>;
  putResult?: { ok: boolean };
}) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/settings/company") {
      if (init?.method === "PUT") {
        return json({ success: true }, opts.putResult?.ok === false ? 500 : 200);
      }
      return json(opts.settings ?? {});
    }
    return json({});
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PhotoReportDefaultsTab", () => {
  it("renders only the photos-per-page knob — no template / preparer / footer fields", async () => {
    stubFetch({ settings: {} });

    render(<PhotoReportDefaultsTab />);

    // Photos-per-page buttons must be present.
    expect(
      await screen.findByRole("button", { name: /1 per page/i }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /2 per page/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /4 per page/i })).toBeDefined();

    // The three retired controls must be gone. Labels in this file aren't
    // associated via htmlFor, so we check by visible text instead.
    expect(screen.queryByText(/default template/i)).toBeNull();
    expect(screen.queryByText(/preparer/i)).toBeNull();
    expect(screen.queryByText(/footer/i)).toBeNull();
  });

  it("defaults to 2-per-page on a fresh load (no saved value)", async () => {
    stubFetch({ settings: {} });

    render(<PhotoReportDefaultsTab />);

    const twoBtn = await screen.findByRole("button", { name: /2 per page/i });
    // The selected button gets the gradient class; the simpler check is that
    // it carries the `text-white` class (only the selected one does in the
    // current visual style).
    await waitFor(() => {
      expect(twoBtn.className).toMatch(/text-white/);
    });
  });

  it("reads back the saved photos-per-page from /api/settings/company", async () => {
    stubFetch({ settings: { report_photos_per_page: "4" } });

    render(<PhotoReportDefaultsTab />);

    const fourBtn = await screen.findByRole("button", { name: /4 per page/i });
    await waitFor(() => {
      expect(fourBtn.className).toMatch(/text-white/);
    });
  });

  it("saves only report_photos_per_page (none of the dropped keys)", async () => {
    const fetchSpy = stubFetch({ settings: { report_photos_per_page: "2" } });

    render(<PhotoReportDefaultsTab />);

    fireEvent.click(await screen.findByRole("button", { name: /1 per page/i }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const putCall = fetchSpy.mock.calls.find(
        (c) =>
          String(c[0]) === "/api/settings/company" &&
          (c[1] as RequestInit | undefined)?.method === "PUT",
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse(String((putCall![1] as RequestInit).body));
      expect(body).toEqual({ report_photos_per_page: "1" });
    });
  });
});
