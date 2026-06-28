// #704 (ADR 0020) — the Organization-timezone control in Company Settings.
//
// The setting is one `timezone` key in `company_settings`. When unset, the UI
// proposes a default derived from the SAVED business-address state via the
// static US-state → IANA map, and that proposal is never persisted until the
// owner explicitly Saves. A saved value reads back on reload. Tests drive the
// public behavior through the DOM: what the dropdown shows on load, and exactly
// what the Save PUT carries.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { TimezoneSection } from "./timezone-section";

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

const dropdown = () =>
  screen.getByLabelText(/organization timezone/i) as HTMLSelectElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TimezoneSection — proposal from the saved address state", () => {
  it("proposes the state-derived default when no timezone is stored (TX → Central)", async () => {
    stubFetch({ settings: { address_state: "TX" } });

    render(<TimezoneSection />);

    await waitFor(() => {
      expect(dropdown().value).toBe("America/Chicago");
    });
    // The proposal is labelled as not-yet-saved, sourced from the address.
    expect(screen.getByText(/proposed from your TX business address/i)).toBeDefined();
  });

  it("does NOT persist the proposal — no PUT happens without an explicit Save", async () => {
    const fetchSpy = stubFetch({ settings: { address_state: "TX" } });

    render(<TimezoneSection />);
    await waitFor(() => expect(dropdown().value).toBe("America/Chicago"));

    // Only the initial GET should have fired; the proposal is in-memory only.
    const putCalls = fetchSpy.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCalls).toHaveLength(0);
  });

  it("defaults to UTC (not host-local) when no state is saved", async () => {
    stubFetch({ settings: {} });

    render(<TimezoneSection />);

    await waitFor(() => {
      expect(dropdown().value).toBe("UTC");
    });
    expect(screen.getByText(/defaulting to UTC/i)).toBeDefined();
  });
});

describe("TimezoneSection — saved value", () => {
  it("reads back a stored timezone, which wins over the address default", async () => {
    // TX would propose Central, but a saved Eastern value wins.
    stubFetch({
      settings: { timezone: "America/New_York", address_state: "TX" },
    });

    render(<TimezoneSection />);

    await waitFor(() => {
      expect(dropdown().value).toBe("America/New_York");
    });
    expect(screen.getByText(/saved\./i)).toBeDefined();
  });

  it("Save writes the chosen IANA string to the timezone key", async () => {
    const fetchSpy = stubFetch({ settings: { address_state: "TX" } });

    render(<TimezoneSection />);
    await waitFor(() => expect(dropdown().value).toBe("America/Chicago"));

    // Owner overrides the proposal and saves.
    fireEvent.change(dropdown(), {
      target: { value: "America/Denver" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save timezone/i }));

    const body = await putBody(fetchSpy);
    expect(body).toEqual({ timezone: "America/Denver" });
  });
});
