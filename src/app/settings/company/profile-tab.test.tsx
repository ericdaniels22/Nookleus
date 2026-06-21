// Issue #704 — the Organization timezone control in Company Settings (ADR 0020).
//
// The Company profile tab gains a single Organization-timezone picker. When no
// `timezone` key is stored it proposes a default derived from the saved
// business-address state (the static US-state → IANA map), but never persists
// that proposal until the owner explicitly saves. A saved IANA zone wins over
// the proposal on reload. No location is captured — only a chosen zone name
// (ADR 0019).
//
// Tests drive the public behavior through the DOM: what the picker shows on
// load, that loading never writes, and exactly what the Save PUT carries.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ProfileTab } from "./profile-tab";

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

// Every PUT the Save button sent to the company route.
function companyPuts(fetchSpy: ReturnType<typeof vi.fn>) {
  return fetchSpy.mock.calls.filter(
    (c) =>
      String(c[0]) === "/api/settings/company" &&
      (c[1] as RequestInit | undefined)?.method === "PUT",
  );
}

// Pull the body of the (single) Save PUT to the company route.
async function putBody(
  fetchSpy: ReturnType<typeof vi.fn>,
): Promise<Record<string, string>> {
  let body: Record<string, string> | undefined;
  await waitFor(() => {
    const putCall = companyPuts(fetchSpy)[0];
    expect(putCall).toBeDefined();
    body = JSON.parse(String((putCall![1] as RequestInit).body));
  });
  return body!;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProfileTab — Organization timezone", () => {
  it("proposes the address-state default zone when none is stored, and does not persist it on load (AC2)", async () => {
    const fetchSpy = stubFetch({ settings: { address_state: "TX" } });

    render(<ProfileTab />);

    const tz = (await screen.findByRole("combobox", {
      name: /timezone/i,
    })) as HTMLSelectElement;
    // A TX business address proposes Central time.
    await waitFor(() => expect(tz.value).toBe("America/Chicago"));
    // The proposal is shown only — loading must never write it back.
    expect(companyPuts(fetchSpy)).toHaveLength(0);
  });

  it("writes the chosen timezone to the timezone key on Save (AC1)", async () => {
    const fetchSpy = stubFetch({ settings: { address_state: "TX" } });

    render(<ProfileTab />);

    const tz = (await screen.findByRole("combobox", {
      name: /timezone/i,
    })) as HTMLSelectElement;
    await waitFor(() => expect(tz.value).toBe("America/Chicago"));

    // Override the proposal, then save.
    fireEvent.change(tz, { target: { value: "America/New_York" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    const body = await putBody(fetchSpy);
    expect(body.timezone).toBe("America/New_York");
  });

  it("reads back a saved timezone, choosing it over the address proposal (AC1)", async () => {
    // Stored Eastern wins even though the TX address would otherwise propose
    // Central — the saved IANA zone is authoritative on reload.
    stubFetch({
      settings: { timezone: "America/New_York", address_state: "TX" },
    });

    render(<ProfileTab />);

    const tz = (await screen.findByRole("combobox", {
      name: /timezone/i,
    })) as HTMLSelectElement;
    await waitFor(() => expect(tz.value).toBe("America/New_York"));
  });
});
