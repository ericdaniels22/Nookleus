// PRD #304 — Nookleus Phone. Slice 12 (#316) — Job-page Calls (N) section.
//
// RTL integration tests for the Calls section that sits alongside the
// Messages (N) and Emails (N) sections on every Job page. AC bullets pinned
// here:
//   - "Job page renders Calls (N) for view_phone users"
//   - "Section hidden for users without view_phone"
//   - "(N) = count of phone_calls whose job_tag = current job"
//   - "each call shows direction, counterparty, status/duration, time"
//   - "a recorded call plays its recording; a voicemail plays + shows transcript"
//   - "a new Job-tagged call surfaces live"
//
// The section is a client component; we mock useAuth (the view_phone gate),
// fetch (the GET /api/phone/calls?jobId= read and the per-recording signed
// URL), and usePhoneSync (the realtime subscription).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const auth = vi.hoisted(() => ({
  value: {
    loading: false,
    hasPermission: (_k: string) => false as boolean,
  },
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => auth.value,
}));

// Capture the realtime subscription the section wires up so a test can fire
// INSERT/UPDATE events at it. The section feeds usePhoneSync a browser
// Supabase client; we stub createClient so the client component can mount
// under jsdom without a real connection.
const sync = vi.hoisted(() => ({
  input: null as {
    organizationId: string | null;
    onNewCall?: (row: unknown) => void;
    onCallUpdate?: (row: unknown) => void;
    onVoicemailUpdate?: (row: unknown) => void;
  } | null,
}));
vi.mock("@/lib/phone/use-phone-sync", () => ({
  usePhoneSync: (input: unknown) => {
    sync.input = input as typeof sync.input;
  },
}));
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({}) as never,
}));

import { JobCallsSection } from "./job-calls-section";

type Voicemail = {
  id: string;
  audio_storage_path: string | null;
  transcript: string | null;
  transcript_status: "pending" | "ready" | "failed";
  duration_seconds: number | null;
};
type Recording = {
  id: string;
  audio_storage_path: string | null;
  consent_notice_played: boolean;
  duration_seconds: number | null;
};
type CallRow = {
  id: string;
  conversation_id: string;
  direction: "in" | "out";
  from_e164: string;
  to_e164: string;
  status: string | null;
  duration_seconds: number | null;
  started_at: string;
  ended_at: string | null;
  job_tag: string | null;
  voicemail?: Voicemail | null;
  recording?: Recording | null;
};

function call(overrides: Partial<CallRow> = {}): CallRow {
  return {
    id: "call-1",
    conversation_id: "conv-1",
    direction: "in",
    from_e164: "+15125550001",
    to_e164: "+15125559999",
    status: "completed",
    duration_seconds: 42,
    started_at: "2026-06-01T10:00:00Z",
    ended_at: "2026-06-01T10:00:42Z",
    job_tag: "job-1",
    voicemail: null,
    recording: null,
    ...overrides,
  };
}

function asViewPhone() {
  auth.value = {
    loading: false,
    hasPermission: (k: string) => k === "view_phone",
  };
}
function asNoPhone() {
  auth.value = { loading: false, hasPermission: () => false };
}

function stubCalls(rows: CallRow[]) {
  const spy = vi.fn(
    async () =>
      new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

const contacts = [{ id: "c1", name: "Homer Owner", phone: "+15125550001" }];

beforeEach(() => {
  vi.clearAllMocks();
  sync.input = null;
});

describe("JobCallsSection — render", () => {
  it("renders Calls (N) with the job's calls for a view_phone user", async () => {
    asViewPhone();
    stubCalls([
      call({ id: "c-a", direction: "in" }),
      call({ id: "c-b", direction: "out" }),
    ]);

    render(
      <JobCallsSection jobId="job-1" organizationId="org-1" contacts={contacts} />,
    );

    expect(await screen.findByText("Calls (2)")).toBeDefined();
  });

  it("renders nothing — and does not even fetch — for a user without view_phone", () => {
    asNoPhone();
    const spy = stubCalls([call()]);

    const { container } = render(
      <JobCallsSection jobId="job-1" organizationId="org-1" contacts={contacts} />,
    );

    expect(container.querySelector("h3")).toBeNull();
    expect(screen.queryByText(/Calls \(/)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    // …and it withholds the realtime subscription end-to-end: the section
    // feeds usePhoneSync organizationId:null when the user lacks view_phone,
    // so the hook (proven by its own null-org test) opens no channel.
    expect(sync.input?.organizationId).toBeNull();
  });

  it("shows Calls (0) and an empty-state when the job has no calls", async () => {
    asViewPhone();
    stubCalls([]);

    render(
      <JobCallsSection jobId="job-1" organizationId="org-1" contacts={contacts} />,
    );

    expect(await screen.findByText("Calls (0)")).toBeDefined();
    expect(screen.getByText(/no (phone )?calls/i)).toBeDefined();
  });
});

describe("JobCallsSection — call rows", () => {
  it("renders each call with its counterparty label and duration, and 'no answer' for an unanswered call", async () => {
    asViewPhone();
    stubCalls([
      // inbound, answered, from a known contact → his name + talk time
      call({
        id: "c-in",
        direction: "in",
        from_e164: "+15125550001",
        to_e164: "+15125559999",
        status: "completed",
        duration_seconds: 42,
      }),
      // outbound, answered, to an unknown number → the formatted number + time
      call({
        id: "c-out",
        direction: "out",
        from_e164: "+15125559999",
        to_e164: "+15125557777",
        status: "completed",
        duration_seconds: 95,
      }),
      // inbound, unanswered (no_answer) → "no answer", and NO duration
      call({
        id: "c-missed",
        direction: "in",
        from_e164: "+15125558888",
        to_e164: "+15125559999",
        status: "no_answer",
        duration_seconds: null,
      }),
    ]);

    render(
      <JobCallsSection jobId="job-1" organizationId="org-1" contacts={contacts} />,
    );

    expect(await screen.findByText("Calls (3)")).toBeDefined();
    // Counterparty: known contact by name, unknown by formatted number.
    expect(screen.getByText("Homer Owner")).toBeDefined();
    expect(screen.getByText("(512) 555-7777")).toBeDefined();
    expect(screen.getByText("(512) 555-8888")).toBeDefined();
    // Answered calls show talk time (mm:ss); the unanswered call says so.
    expect(screen.getByText("0:42")).toBeDefined();
    expect(screen.getByText("1:35")).toBeDefined();
    expect(screen.getByText(/no answer/i)).toBeDefined();
    // A null duration must NOT render as "0:00".
    expect(screen.queryByText("0:00")).toBeNull();
  });

  it("plays a recorded call's recording, signed from the recordings endpoint", async () => {
    asViewPhone();
    const spy = vi.fn(async (url: string) => {
      if (String(url).includes("/api/phone/recordings")) {
        return new Response(
          JSON.stringify({ url: "https://signed/org-1/rec-1.mp3" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify([
          call({
            id: "c-rec",
            direction: "out",
            recording: {
              id: "rec-1",
              audio_storage_path: "org-1/rec-1.mp3",
              consent_notice_played: true,
              duration_seconds: 30,
            },
          }),
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", spy);

    const { container } = render(
      <JobCallsSection jobId="job-1" organizationId="org-1" contacts={contacts} />,
    );

    await screen.findByText("Calls (1)");
    await waitFor(() => {
      const audio = container.querySelector(
        'audio[aria-label="Call recording"]',
      );
      expect(audio?.getAttribute("src")).toBe("https://signed/org-1/rec-1.mp3");
    });
    const signed = spy.mock.calls.find(([u]) =>
      String(u).includes("/api/phone/recordings"),
    );
    expect(String(signed![0])).toContain(
      `path=${encodeURIComponent("org-1/rec-1.mp3")}`,
    );
  });

  it("plays a voicemail and shows its transcript when the call went to voicemail", async () => {
    asViewPhone();
    const spy = vi.fn(async (url: string) => {
      if (String(url).includes("/api/phone/recordings")) {
        return new Response(
          JSON.stringify({ url: "https://signed/org-1/vm-1.mp3" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify([
          call({
            id: "c-vm",
            direction: "in",
            status: "no_answer",
            duration_seconds: null,
            voicemail: {
              id: "vm-1",
              audio_storage_path: "org-1/vm-1.mp3",
              transcript: "Call me back about the roof",
              transcript_status: "ready",
              duration_seconds: 12,
            },
          }),
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", spy);

    const { container } = render(
      <JobCallsSection jobId="job-1" organizationId="org-1" contacts={contacts} />,
    );

    await screen.findByText("Calls (1)");
    expect(
      await screen.findByText("Call me back about the roof"),
    ).toBeDefined();
    await waitFor(() => {
      const audio = container.querySelector(
        'audio[aria-label="Voicemail recording"]',
      );
      expect(audio?.getAttribute("src")).toBe("https://signed/org-1/vm-1.mp3");
    });
  });
});

describe("JobCallsSection — deep link", () => {
  it("links each call to its Phone-tab thread, scrolled to that call", async () => {
    asViewPhone();
    stubCalls([call({ id: "c-1", conversation_id: "conv-7", direction: "out" })]);

    render(
      <JobCallsSection jobId="job-1" organizationId="org-1" contacts={contacts} />,
    );

    await screen.findByText("Calls (1)");
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(
      "/phone?conversation=conv-7&call=c-1",
    );
  });
});

describe("JobCallsSection — realtime", () => {
  it("subscribes for the org and bumps the count when a new Job-tagged call arrives", async () => {
    asViewPhone();

    // First GET: one call. After the realtime INSERT fires, the refetch
    // returns the freshly-tagged second call.
    let getCount = 0;
    const spy = vi.fn(async () => {
      getCount += 1;
      const rows =
        getCount === 1
          ? [call({ id: "c-1" })]
          : [call({ id: "c-1" }), call({ id: "c-2", direction: "out" })];
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", spy);

    render(
      <JobCallsSection jobId="job-1" organizationId="org-1" contacts={contacts} />,
    );

    expect(await screen.findByText("Calls (1)")).toBeDefined();
    // The section wired a realtime subscription scoped to the active org.
    expect(sync.input?.organizationId).toBe("org-1");

    // A new outbound call to this Job lands over realtime → the section
    // refetches and the count climbs.
    sync.input!.onNewCall!({ id: "c-2", job_tag: "job-1" });

    expect(await screen.findByText("Calls (2)")).toBeDefined();
  });
});
