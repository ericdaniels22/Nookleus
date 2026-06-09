// Issue #550 — Settings → Report Defaults admin UI (ADR 0014).
//
// The Organization's Report layout default is the seed every new report copies:
// photos-per-page (2 / 3 / 4 — the 1-per-page layout was retired in ADR 0014)
// plus the six detail toggles (Section Title Pages, Photo numbers, Captured by,
// Location, Date captured, Photo tags), all default on. The tab reads and writes
// these as `company_settings` key/value rows under REPORT_DEFAULT_SETTING_KEYS.
//
// Tests drive the public behavior through the DOM: which controls render, what
// loads selected/checked, and exactly what the Save PUT carries.

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

// Pull the PUT body the Save button sent (the only PUT to the company route).
async function putBody(
  fetchSpy: ReturnType<typeof vi.fn>,
): Promise<Record<string, string>> {
  let body: Record<string, string> | undefined;
  await waitFor(() => {
    const putCall = fetchSpy.mock.calls.find(
      (c) =>
        String(c[0]) === "/api/settings/company" &&
        (c[1] as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    body = JSON.parse(String((putCall![1] as RequestInit).body));
  });
  return body!;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PhotoReportDefaultsTab — photos per page", () => {
  it("offers 2 / 3 / 4 per page (the 1-per-page layout was retired in ADR 0014)", async () => {
    stubFetch({ settings: {} });

    render(<PhotoReportDefaultsTab />);

    expect(
      await screen.findByRole("button", { name: /2 per page/i }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /3 per page/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /4 per page/i })).toBeDefined();
    // The retired 1-per-page option must be gone.
    expect(screen.queryByRole("button", { name: /1 per page/i })).toBeNull();
  });

  it("defaults to 2-per-page on a fresh load (no saved value)", async () => {
    stubFetch({ settings: {} });

    render(<PhotoReportDefaultsTab />);

    const twoBtn = await screen.findByRole("button", { name: /2 per page/i });
    // Selection is exposed semantically via aria-pressed, not a CSS class, so
    // this survives a visual refactor of the gradient styling.
    await waitFor(() => {
      expect(twoBtn.getAttribute("aria-pressed")).toBe("true");
    });
  });

  it("reads back the saved photos-per-page from /api/settings/company", async () => {
    stubFetch({ settings: { report_photos_per_page: "3" } });

    render(<PhotoReportDefaultsTab />);

    const threeBtn = await screen.findByRole("button", { name: /3 per page/i });
    await waitFor(() => {
      expect(threeBtn.getAttribute("aria-pressed")).toBe("true");
    });
    // And the previously-selected default is no longer pressed.
    expect(
      screen.getByRole("button", { name: /2 per page/i }).getAttribute("aria-pressed"),
    ).toBe("false");
  });
});

describe("PhotoReportDefaultsTab — detail toggles", () => {
  it("renders all six detail toggles, every one on by default (no saved value)", async () => {
    stubFetch({ settings: {} });

    render(<PhotoReportDefaultsTab />);

    const checkbox = (name: RegExp) =>
      screen.getByRole("checkbox", { name }) as HTMLInputElement;
    await screen.findByRole("checkbox", { name: /section title pages/i });
    expect(checkbox(/section title pages/i).checked).toBe(true);
    expect(checkbox(/photo numbers/i).checked).toBe(true);
    expect(checkbox(/captured by/i).checked).toBe(true);
    expect(checkbox(/location/i).checked).toBe(true);
    expect(checkbox(/date captured/i).checked).toBe(true);
    expect(checkbox(/photo tags/i).checked).toBe(true);
  });

  it("reads back a saved toggle that was turned off", async () => {
    stubFetch({ settings: { report_detail_photo_tags: "false" } });

    render(<PhotoReportDefaultsTab />);

    const photoTags = (await screen.findByRole("checkbox", {
      name: /photo tags/i,
    })) as HTMLInputElement;
    await waitFor(() => {
      expect(photoTags.checked).toBe(false);
    });
    // Other toggles, unset, stay on.
    expect(
      (screen.getByRole("checkbox", { name: /location/i }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
});

describe("PhotoReportDefaultsTab — saving", () => {
  it("saves all seven layout keys: photos-per-page plus the six detail toggles", async () => {
    const fetchSpy = stubFetch({ settings: {} });

    render(<PhotoReportDefaultsTab />);

    // Change the density and flip one toggle off, then save.
    fireEvent.click(await screen.findByRole("button", { name: /3 per page/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /photo tags/i }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    const body = await putBody(fetchSpy);
    // Every key is written as a string (company_settings is key/value text), so
    // a new report's seed is fully specified, not partially defaulted.
    expect(body).toEqual({
      report_photos_per_page: "3",
      report_detail_section_title_pages: "true",
      report_detail_photo_numbers: "true",
      report_detail_captured_by: "true",
      report_detail_location: "true",
      report_detail_date_captured: "true",
      report_detail_photo_tags: "false",
    });
  });
});
