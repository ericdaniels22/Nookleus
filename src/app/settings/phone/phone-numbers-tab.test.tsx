// PRD #304 — Nookleus Phone. Slice 3 (#307) — Settings → Phone admin page.
//
// RTL integration tests for the list rendering and the admin gate. AC
// bullets pinned here:
//   - "Admin can provision a real Twilio number from Settings → Phone …
//     number appears in the page's list" (the list-rendering half — the
//     real Twilio call is exercised by the route test)
//   - "Non-admin cannot see Settings → Phone or hit its routes" (the
//     non-admin gate at the surface level)
//
// The page itself is a client component; we mock fetch and feed it the
// JSON shape /api/phone/numbers returns.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const auth = vi.hoisted(() => ({
  value: {
    profile: null as { id: string; full_name: string; role: string } | null,
    loading: false,
  },
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => auth.value,
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { PhoneNumbersTab } from "./phone-numbers-tab";

type PhoneNumberRow = {
  id: string;
  organization_id: string;
  twilio_sid: string;
  e164: string;
  label: string | null;
  kind: "shared" | "personal";
  user_id: string | null;
  inbound_rule: unknown | null;
  monthly_cost_cents: number | null;
  is_active: boolean;
  released_at: string | null;
  created_at: string;
};

function row(overrides: Partial<PhoneNumberRow> = {}): PhoneNumberRow {
  return {
    id: "row-1",
    organization_id: "org-1",
    twilio_sid: "PNxxx",
    e164: "+15125551234",
    label: "Marketing",
    kind: "shared",
    user_id: null,
    inbound_rule: null,
    monthly_cost_cents: 115,
    is_active: true,
    released_at: null,
    created_at: "2026-05-27T00:00:00Z",
    ...overrides,
  };
}

type Available = {
  phoneNumber: string;
  friendlyName: string;
  locality: string | null;
  region: string | null;
};

function stubFetch(opts: {
  rows?: PhoneNumberRow[];
  available?: Available[];
  postResult?: PhoneNumberRow;
  releaseResult?: PhoneNumberRow;
}) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/phone/numbers/available")) {
      return json(opts.available ?? []);
    }
    if (url.match(/\/api\/phone\/numbers\/[^/]+\/release$/)) {
      return json(opts.releaseResult ?? row({ released_at: "2026-05-27T01:00:00Z" }));
    }
    if (url.startsWith("/api/phone/numbers")) {
      if (init?.method === "POST") {
        return json(opts.postResult ?? row({ id: "row-new" }), 201);
      }
      return json(opts.rows ?? []);
    }
    return json({});
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function asAdmin() {
  auth.value = {
    profile: { id: "admin-1", full_name: "Ada Admin", role: "admin" },
    loading: false,
  };
}
function asNonAdmin() {
  auth.value = {
    profile: { id: "user-1", full_name: "Nick NonAdmin", role: "crew_lead" },
    loading: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PhoneNumbersTab — list rendering", () => {
  it("renders each row with kind / e164 / label / monthly-cost columns", async () => {
    asAdmin();
    stubFetch({
      rows: [
        row({
          id: "r1",
          kind: "shared",
          label: "Front Desk",
          e164: "+15125551234",
          monthly_cost_cents: 115,
        }),
      ],
    });

    render(<PhoneNumbersTab />);

    expect(await screen.findByText("Front Desk")).toBeDefined();
    // Display format from phone.ts is (XXX) XXX-XXXX
    expect(screen.getByText("(512) 555-1234")).toBeDefined();
    // Monthly cost shown in dollars (centsâ‡’$, two decimals).
    expect(screen.getByText("$1.15")).toBeDefined();
    expect(screen.getByText("Shared")).toBeDefined();
  });

  it("shows the inbound-rule placeholder copy for Shared rows (slice 8 lands the configurator)", async () => {
    asAdmin();
    stubFetch({ rows: [row()] });

    render(<PhoneNumbersTab />);

    expect(await screen.findByText(/ring-all default/i)).toBeDefined();
  });

  it("shows the empty-state when no rows exist", async () => {
    asAdmin();
    stubFetch({ rows: [] });

    render(<PhoneNumbersTab />);

    expect(
      await screen.findByText(/No phone numbers yet/i),
    ).toBeDefined();
  });
});

describe("PhoneNumbersTab — admin gate", () => {
  it("hides the Add Shared Number button from a non-admin", async () => {
    asNonAdmin();
    stubFetch({ rows: [row()] });

    render(<PhoneNumbersTab />);

    // The list itself can render — view_phone is enough for non-admins to
    // see the surface (matches the email page's behavior). What they must
    // not see is the management affordance.
    await screen.findByText("Marketing");
    expect(
      screen.queryByRole("button", { name: /add shared number/i }),
    ).toBeNull();
  });

  it("hides the per-row Release button from a non-admin", async () => {
    asNonAdmin();
    stubFetch({ rows: [row()] });

    render(<PhoneNumbersTab />);

    await screen.findByText("Marketing");
    expect(screen.queryByRole("button", { name: /release/i })).toBeNull();
  });

  it("shows the Add Shared Number button to an admin", async () => {
    asAdmin();
    stubFetch({ rows: [] });

    render(<PhoneNumbersTab />);

    expect(
      await screen.findByRole("button", { name: /add shared number/i }),
    ).toBeDefined();
  });
});

describe("PhoneNumbersTab — Add Shared Number flow", () => {
  it("opens an area-code prompt, searches Twilio, lets admin pick + save", async () => {
    asAdmin();
    const fetchSpy = stubFetch({
      rows: [],
      available: [
        {
          phoneNumber: "+15125551234",
          friendlyName: "(512) 555-1234",
          locality: "Austin",
          region: "TX",
        },
      ],
      postResult: row({ id: "new", e164: "+15125551234", label: "New" }),
    });

    render(<PhoneNumbersTab />);

    fireEvent.click(
      await screen.findByRole("button", { name: /add shared number/i }),
    );

    // Area-code field is visible and accepts input.
    const areaCode = screen.getByLabelText(/area code/i);
    fireEvent.change(areaCode, { target: { value: "512" } });

    fireEvent.click(screen.getByRole("button", { name: /search/i }));

    // The returned number shows up.
    await screen.findByText("(512) 555-1234");

    // Picking the number reveals the label field + a Provision button.
    fireEvent.click(screen.getByText("(512) 555-1234"));

    const labelField = await screen.findByLabelText(/label/i);
    fireEvent.change(labelField, { target: { value: "New" } });

    fireEvent.click(screen.getByRole("button", { name: /provision/i }));

    // The POST body carries the picked E.164 + the typed label.
    await waitFor(() => {
      const postCall = fetchSpy.mock.calls.find(
        (c) =>
          String(c[0]) === "/api/phone/numbers" &&
          (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(String((postCall![1] as RequestInit).body));
      expect(body).toEqual({ phoneNumber: "+15125551234", label: "New" });
    });
  });
});

describe("PhoneNumbersTab — Release flow", () => {
  it("admin clicks Release, confirms, the row is hit on /release", async () => {
    asAdmin();
    const fetchSpy = stubFetch({
      rows: [row({ id: "row-shared", twilio_sid: "PNshared" })],
      releaseResult: row({
        id: "row-shared",
        released_at: "2026-05-27T01:00:00Z",
      }),
    });

    render(<PhoneNumbersTab />);

    fireEvent.click(await screen.findByRole("button", { name: /release/i }));

    // The confirm step shows the e164 the admin is about to release.
    expect(screen.getByText(/release \(512\) 555-1234/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      const releaseCall = fetchSpy.mock.calls.find((c) =>
        String(c[0]).endsWith("/row-shared/release"),
      );
      expect(releaseCall).toBeDefined();
      expect((releaseCall![1] as RequestInit | undefined)?.method).toBe(
        "POST",
      );
    });
  });
});
