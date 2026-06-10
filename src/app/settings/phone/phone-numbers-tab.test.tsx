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

// Slice 13 (#317) — the record-in-browser path. The recorder is browser-only
// Web Audio glue; the component test injects a fake recording that yields a
// known WAV Blob on stop, so the UI's "record → save" wiring is exercised
// without a real microphone.
const startMicWavRecordingMock = vi.fn();
vi.mock("@/lib/phone/mic-wav-recorder", () => ({
  startMicWavRecording: (...args: unknown[]) => startMicWavRecordingMock(...args),
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
  voicemail_greeting_url: string | null;
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
    voicemail_greeting_url: null,
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

type Member = {
  id: string;
  full_name: string;
  phone: string | null;
  role: string;
};

function stubFetch(opts: {
  rows?: PhoneNumberRow[];
  available?: Available[];
  members?: Member[];
  postResult?: PhoneNumberRow;
  releaseResult?: PhoneNumberRow;
  patchResult?: PhoneNumberRow;
  greetingResult?: PhoneNumberRow;
}) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/settings/users")) {
      return json(opts.members ?? []);
    }
    if (url.startsWith("/api/phone/numbers/available")) {
      return json(opts.available ?? []);
    }
    // Slice 13 (#317) — set (PUT) / clear (DELETE) a number's greeting. Must be
    // matched before the generic /api/phone/numbers branch below.
    if (url.match(/\/api\/phone\/numbers\/[^/]+\/voicemail-greeting$/)) {
      return json(opts.greetingResult ?? row(), 200);
    }
    if (url.match(/\/api\/phone\/numbers\/[^/]+\/release$/)) {
      return json(opts.releaseResult ?? row({ released_at: "2026-05-27T01:00:00Z" }));
    }
    if (url.startsWith("/api/phone/numbers")) {
      if (init?.method === "POST") {
        return json(opts.postResult ?? row({ id: "row-new" }), 201);
      }
      if (init?.method === "PATCH") {
        return json(opts.patchResult ?? row(), 200);
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
  startMicWavRecordingMock.mockReset();
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

  it("summarizes an unconfigured Shared number as Voicemail (decideShared's null default)", async () => {
    asAdmin();
    stubFetch({ rows: [row({ inbound_rule: null })] });

    render(<PhoneNumbersTab />);

    await screen.findByText("Marketing");
    // An unconfigured Shared number has inbound_rule = null. decideShared
    // falls through to voicemail for a null config, so the cell must say
    // Voicemail — not the old (untruthful) "ring-all default" placeholder.
    expect(screen.getByText(/^voicemail$/i)).toBeDefined();
  });

  it("summarizes a ring-all rule with the member count", async () => {
    asAdmin();
    stubFetch({
      rows: [
        row({ inbound_rule: { kind: "ring-all", users: ["u1", "u2"] } }),
      ],
    });

    render(<PhoneNumbersTab />);

    await screen.findByText("Marketing");
    expect(screen.getByText(/ring all \(2\)/i)).toBeDefined();
  });

  it("summarizes a round-robin rule with the sequence length", async () => {
    asAdmin();
    stubFetch({
      rows: [
        row({
          inbound_rule: { kind: "round-robin", sequence: ["u1", "u2", "u3"] },
        }),
      ],
    });

    render(<PhoneNumbersTab />);

    await screen.findByText("Marketing");
    expect(screen.getByText(/round robin \(3\)/i)).toBeDefined();
  });

  it("summarizes a forward rule as Forward", async () => {
    asAdmin();
    stubFetch({
      rows: [row({ inbound_rule: { kind: "forward", forwardUserId: "u2" } })],
    });

    render(<PhoneNumbersTab />);

    await screen.findByText("Marketing");
    expect(screen.getByText(/^forward$/i)).toBeDefined();
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

describe("PhoneNumbersTab — inbound-rule editor", () => {
  it("admin clicks Configure on a Shared row and the editor opens with the four answer rules", async () => {
    asAdmin();
    stubFetch({ rows: [row({ id: "pn-1" })], members: [] });

    render(<PhoneNumbersTab />);

    fireEvent.click(await screen.findByRole("button", { name: /configure/i }));

    // The kind picker offers the four routable rules (ADR 0006).
    expect(await screen.findByLabelText(/ring all/i)).toBeDefined();
    expect(screen.getByLabelText(/round robin/i)).toBeDefined();
    expect(screen.getByLabelText(/forward/i)).toBeDefined();
    expect(screen.getByLabelText(/^voicemail$/i)).toBeDefined();
  });

  it("hides the Configure button from a non-admin (Shared is admin-only, ADR 0003)", async () => {
    asNonAdmin();
    stubFetch({ rows: [row({ id: "pn-1" })], members: [] });

    render(<PhoneNumbersTab />);

    await screen.findByText("Marketing");
    expect(
      screen.queryByRole("button", { name: /configure/i }),
    ).toBeNull();
  });

  it("lists members with a cell as selectable, omitting those without one", async () => {
    asAdmin();
    stubFetch({
      rows: [row({ id: "pn-1", inbound_rule: { kind: "ring-all", users: [] } })],
      members: [
        { id: "u1", full_name: "Has Cell", phone: "+15125550001", role: "admin" },
        { id: "u2", full_name: "No Cell", phone: null, role: "crew_lead" },
      ],
    });

    render(<PhoneNumbersTab />);

    fireEvent.click(await screen.findByRole("button", { name: /configure/i }));

    // A member with a cell on file is offered; one without is not —
    // decideShared drops cell-less members, so they could never be part of a
    // routable rule.
    expect(await screen.findByText("Has Cell")).toBeDefined();
    expect(screen.queryByText("No Cell")).toBeNull();
  });

  it("admin checks members and saves a ring-all rule via PATCH", async () => {
    asAdmin();
    const fetchSpy = stubFetch({
      rows: [row({ id: "pn-1", inbound_rule: { kind: "ring-all", users: [] } })],
      members: [
        { id: "u1", full_name: "Has Cell", phone: "+15125550001", role: "admin" },
      ],
      patchResult: row({
        id: "pn-1",
        inbound_rule: { kind: "ring-all", users: ["u1"] },
      }),
    });

    render(<PhoneNumbersTab />);

    fireEvent.click(await screen.findByRole("button", { name: /configure/i }));
    fireEvent.click(await screen.findByLabelText(/has cell/i));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(
        (c) =>
          String(c[0]) === "/api/phone/numbers/pn-1" &&
          (c[1] as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse(String((patchCall![1] as RequestInit).body));
      expect(body).toEqual({
        inbound_rule: { kind: "ring-all", users: ["u1"] },
      });
    });
  });

  it("admin switches a number to voicemail and saves via PATCH", async () => {
    asAdmin();
    const fetchSpy = stubFetch({
      rows: [
        row({ id: "pn-1", inbound_rule: { kind: "ring-all", users: ["u1"] } }),
      ],
      members: [
        { id: "u1", full_name: "Has Cell", phone: "+15125550001", role: "admin" },
      ],
      patchResult: row({ id: "pn-1", inbound_rule: { kind: "voicemail" } }),
    });

    render(<PhoneNumbersTab />);

    fireEvent.click(await screen.findByRole("button", { name: /configure/i }));
    fireEvent.click(await screen.findByLabelText(/^voicemail$/i));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(
        (c) =>
          String(c[0]) === "/api/phone/numbers/pn-1" &&
          (c[1] as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse(String((patchCall![1] as RequestInit).body));
      expect(body).toEqual({ inbound_rule: { kind: "voicemail" } });
    });
  });

  it("admin picks one member to forward to (single-select) and saves via PATCH", async () => {
    asAdmin();
    const fetchSpy = stubFetch({
      rows: [row({ id: "pn-1", inbound_rule: { kind: "voicemail" } })],
      members: [
        {
          id: "u1",
          full_name: "First Cell",
          phone: "+15125550001",
          role: "admin",
        },
        {
          id: "u2",
          full_name: "Second Cell",
          phone: "+15125550002",
          role: "crew_lead",
        },
      ],
      patchResult: row({
        id: "pn-1",
        inbound_rule: { kind: "forward", forwardUserId: "u2" },
      }),
    });

    render(<PhoneNumbersTab />);

    fireEvent.click(await screen.findByRole("button", { name: /configure/i }));
    fireEvent.click(await screen.findByLabelText(/forward/i));
    // Forward is single-select: picking First then Second forwards to Second
    // only — the second pick replaces the first.
    fireEvent.click(await screen.findByLabelText(/^first cell$/i));
    fireEvent.click(await screen.findByLabelText(/^second cell$/i));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(
        (c) =>
          String(c[0]) === "/api/phone/numbers/pn-1" &&
          (c[1] as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse(String((patchCall![1] as RequestInit).body));
      expect(body).toEqual({
        inbound_rule: { kind: "forward", forwardUserId: "u2" },
      });
    });
  });

  it("admin orders members and saves a round-robin rule (sequence keeps click order)", async () => {
    asAdmin();
    const fetchSpy = stubFetch({
      rows: [row({ id: "pn-1", inbound_rule: { kind: "voicemail" } })],
      members: [
        {
          id: "u1",
          full_name: "First Cell",
          phone: "+15125550001",
          role: "admin",
        },
        {
          id: "u2",
          full_name: "Second Cell",
          phone: "+15125550002",
          role: "crew_lead",
        },
      ],
      patchResult: row({
        id: "pn-1",
        inbound_rule: { kind: "round-robin", sequence: ["u2", "u1"] },
      }),
    });

    render(<PhoneNumbersTab />);

    fireEvent.click(await screen.findByRole("button", { name: /configure/i }));
    fireEvent.click(await screen.findByLabelText(/round robin/i));
    // The sequence follows click order: Second, then First.
    fireEvent.click(await screen.findByLabelText(/^second cell$/i));
    fireEvent.click(await screen.findByLabelText(/^first cell$/i));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(
        (c) =>
          String(c[0]) === "/api/phone/numbers/pn-1" &&
          (c[1] as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse(String((patchCall![1] as RequestInit).body));
      expect(body).toEqual({
        inbound_rule: { kind: "round-robin", sequence: ["u2", "u1"] },
      });
    });
  });
});

describe("PhoneNumbersTab — Claim Personal Number (slice 13, #317)", () => {
  // ADR 0005: a Personal number is the member's own line — owner-only, hidden
  // from admins. Slice 13 gives any member holding view_phone a self-service
  // claim, scoped to themselves. The affordance is offered only when the
  // member does not already own an active Personal number ("claim when none").

  it("offers a Claim Personal Number button to a member who owns none", async () => {
    asNonAdmin(); // crew_lead user-1
    // Only a Shared number exists; user-1 owns no Personal line.
    stubFetch({ rows: [row()] });

    render(<PhoneNumbersTab />);

    await screen.findByText("Marketing");
    expect(
      await screen.findByRole("button", { name: /claim personal number/i }),
    ).toBeDefined();
  });

  it("searches, picks, and claims a Personal number for the caller (POST kind=personal)", async () => {
    asNonAdmin(); // crew_lead user-1
    const fetchSpy = stubFetch({
      rows: [],
      available: [
        {
          phoneNumber: "+15125559999",
          friendlyName: "(512) 555-9999",
          locality: "Austin",
          region: "TX",
        },
      ],
      postResult: row({
        id: "pers-new",
        kind: "personal",
        user_id: "user-1",
        e164: "+15125559999",
        label: null,
      }),
    });

    render(<PhoneNumbersTab />);

    fireEvent.click(
      await screen.findByRole("button", { name: /claim personal number/i }),
    );

    const areaCode = screen.getByLabelText(/area code/i);
    fireEvent.change(areaCode, { target: { value: "512" } });
    fireEvent.click(screen.getByRole("button", { name: /search/i }));

    fireEvent.click(await screen.findByText("(512) 555-9999"));
    fireEvent.click(screen.getByRole("button", { name: /^claim$/i }));

    await waitFor(() => {
      const postCall = fetchSpy.mock.calls.find(
        (c) =>
          String(c[0]) === "/api/phone/numbers" &&
          (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeDefined();
      // The claim never sends an owner — the route derives it from the
      // session. It carries only the picked number and kind='personal'.
      const body = JSON.parse(String((postCall![1] as RequestInit).body));
      expect(body).toEqual({
        phoneNumber: "+15125559999",
        kind: "personal",
      });
    });
  });

  it("hides the Claim button once the member already owns an active Personal number", async () => {
    asNonAdmin(); // user-1
    stubFetch({
      rows: [
        row({
          id: "p1",
          kind: "personal",
          user_id: "user-1",
          e164: "+15125559999",
          label: null,
        }),
      ],
    });

    render(<PhoneNumbersTab />);

    await screen.findByText("(512) 555-9999");
    // One active Personal line per member: the affordance is gone.
    expect(
      screen.queryByRole("button", { name: /claim personal number/i }),
    ).toBeNull();
  });

  it("labels the viewer's own Personal number owner as You", async () => {
    asNonAdmin(); // user-1
    stubFetch({
      rows: [
        row({
          id: "p1",
          kind: "personal",
          user_id: "user-1",
          e164: "+15125559999",
          label: null,
        }),
      ],
    });

    render(<PhoneNumbersTab />);

    await screen.findByText("(512) 555-9999");
    // The owner column reads "You" for the caller's own line, not a raw id.
    expect(screen.getByText("You")).toBeDefined();
  });
});

describe("PhoneNumbersTab — Voicemail greeting (slice 13, #317)", () => {
  // canManage governs who may set a greeting: Shared → admin; Personal →
  // owner-self (or admin). The affordance mirrors that gate at the surface.

  it("offers a Greeting button to an admin on a Shared number", async () => {
    asAdmin();
    stubFetch({ rows: [row({ id: "pn-1", kind: "shared" })] });

    render(<PhoneNumbersTab />);

    await screen.findByText("Marketing");
    expect(
      screen.getByRole("button", { name: /^greeting$/i }),
    ).toBeDefined();
  });

  it("offers a Greeting button to the owner of a Personal number", async () => {
    asNonAdmin(); // user-1
    stubFetch({
      rows: [
        row({
          id: "p1",
          kind: "personal",
          user_id: "user-1",
          e164: "+15125559999",
          label: null,
        }),
      ],
    });

    render(<PhoneNumbersTab />);

    await screen.findByText("(512) 555-9999");
    expect(
      screen.getByRole("button", { name: /^greeting$/i }),
    ).toBeDefined();
  });

  it("hides the Greeting button from a non-admin on a Shared number", async () => {
    asNonAdmin();
    stubFetch({ rows: [row({ id: "pn-1", kind: "shared" })] });

    render(<PhoneNumbersTab />);

    await screen.findByText("Marketing");
    expect(screen.queryByRole("button", { name: /^greeting$/i })).toBeNull();
  });

  it("uploads an audio file: PUTs multipart form-data with the file to the greeting route", async () => {
    asNonAdmin(); // user-1 owns the Personal line
    const fetchSpy = stubFetch({
      rows: [
        row({ id: "p1", kind: "personal", user_id: "user-1", label: null }),
      ],
      greetingResult: row({
        id: "p1",
        kind: "personal",
        user_id: "user-1",
        voicemail_greeting_url: "org-1/p1.wav",
      }),
    });

    render(<PhoneNumbersTab />);

    fireEvent.click(await screen.findByRole("button", { name: /^greeting$/i }));

    const fileInput = await screen.findByLabelText(/upload audio/i);
    const file = new File([new Uint8Array(64)], "greeting.wav", {
      type: "audio/wav",
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByRole("button", { name: /^save greeting$/i }));

    await waitFor(() => {
      const putCall = fetchSpy.mock.calls.find(
        (c) =>
          String(c[0]) === "/api/phone/numbers/p1/voicemail-greeting" &&
          (c[1] as RequestInit | undefined)?.method === "PUT",
      );
      expect(putCall).toBeDefined();
      const body = (putCall![1] as RequestInit).body as FormData;
      expect(body).toBeInstanceOf(FormData);
      const sent = body.get("file") as File;
      expect(sent.name).toBe("greeting.wav");
      expect(sent.type).toBe("audio/wav");
    });
  });

  it("records in the browser and PUTs the encoded WAV blob as the greeting", async () => {
    asNonAdmin(); // user-1 owns the Personal line
    const wavBlob = new Blob([new Uint8Array(44)], { type: "audio/wav" });
    const stop = vi.fn(async () => wavBlob);
    startMicWavRecordingMock.mockResolvedValue({ stop, cancel: vi.fn() });
    const fetchSpy = stubFetch({
      rows: [
        row({ id: "p1", kind: "personal", user_id: "user-1", label: null }),
      ],
    });

    render(<PhoneNumbersTab />);

    fireEvent.click(await screen.findByRole("button", { name: /^greeting$/i }));

    // Start, then stop the in-browser recording.
    fireEvent.click(await screen.findByRole("button", { name: /^record$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^stop$/i }));

    // Once stopped, the recorder yielded a WAV blob — Save is now possible.
    fireEvent.click(await screen.findByRole("button", { name: /^save greeting$/i }));

    await waitFor(() => {
      expect(startMicWavRecordingMock).toHaveBeenCalled();
      expect(stop).toHaveBeenCalled();
      const putCall = fetchSpy.mock.calls.find(
        (c) =>
          String(c[0]) === "/api/phone/numbers/p1/voicemail-greeting" &&
          (c[1] as RequestInit | undefined)?.method === "PUT",
      );
      expect(putCall).toBeDefined();
      const body = (putCall![1] as RequestInit).body as FormData;
      const sent = body.get("file") as File;
      // The recorded blob is uploaded as a .wav file (audio/wav).
      expect(sent.type).toBe("audio/wav");
      expect(sent.name).toMatch(/\.wav$/);
    });
  });

  it("removes an existing greeting via DELETE", async () => {
    asNonAdmin(); // user-1 owns the Personal line
    const fetchSpy = stubFetch({
      rows: [
        row({
          id: "p1",
          kind: "personal",
          user_id: "user-1",
          label: null,
          voicemail_greeting_url: "org-1/p1.wav",
        }),
      ],
      greetingResult: row({
        id: "p1",
        kind: "personal",
        user_id: "user-1",
        voicemail_greeting_url: null,
      }),
    });

    render(<PhoneNumbersTab />);

    fireEvent.click(await screen.findByRole("button", { name: /^greeting$/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: /remove greeting/i }),
    );

    await waitFor(() => {
      const delCall = fetchSpy.mock.calls.find(
        (c) =>
          String(c[0]) === "/api/phone/numbers/p1/voicemail-greeting" &&
          (c[1] as RequestInit | undefined)?.method === "DELETE",
      );
      expect(delCall).toBeDefined();
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
