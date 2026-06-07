// PRD #304 — Nookleus Phone. Slice 7 (#311) — Job-page Messages (N) section.
//
// RTL integration tests for the Messages section that mirrors the Emails
// section on every Job page. AC bullets pinned here:
//   - "Job page renders Messages (N) for view_phone users"
//   - "Section hidden for users without view_phone"
//   - "(N) = count of phone_messages whose job_tag = current job"
//   - "messages render per Phone-tab thread treatment"
//   - "Text button opens compose with one of the Job's Contacts pre-filled"
//   - "an untagged Phone-tab message re-tagged to a Job immediately surfaces"
//
// The section is a client component; we mock useAuth (the view_phone gate)
// and fetch (the GET /api/phone/messages?jobId= read).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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
    onNewMessage?: (row: unknown) => void;
    onMessageUpdate?: (row: unknown) => void;
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

import { JobMessagesSection } from "./job-messages-section";

type MessageRow = {
  id: string;
  direction: "in" | "out";
  from_e164: string;
  to_e164: string;
  body: string | null;
  media_urls: unknown[];
  sent_at: string;
  job_tag: string | null;
};

function msg(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: "m1",
    direction: "in",
    from_e164: "+15125550001",
    to_e164: "+15125559999",
    body: "Roof is leaking",
    media_urls: [],
    sent_at: "2026-06-01T10:00:00Z",
    job_tag: "job-1",
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

function stubMessages(rows: MessageRow[]) {
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("JobMessagesSection — render", () => {
  it("renders Messages (N) with the job's message bodies for a view_phone user", async () => {
    asViewPhone();
    stubMessages([
      msg({ id: "m1", direction: "in", body: "Roof is leaking" }),
      msg({ id: "m2", direction: "out", body: "On our way" }),
    ]);

    render(
      <JobMessagesSection
        jobId="job-1"
        organizationId="org-1"
        contacts={contacts}
      />,
    );

    expect(await screen.findByText("Messages (2)")).toBeDefined();
    expect(screen.getByText("Roof is leaking")).toBeDefined();
    expect(screen.getByText("On our way")).toBeDefined();
  });

  it("renders nothing — and does not even fetch — for a user without view_phone", () => {
    asNoPhone();
    const spy = stubMessages([msg()]);

    const { container } = render(
      <JobMessagesSection
        jobId="job-1"
        organizationId="org-1"
        contacts={contacts}
      />,
    );

    expect(container.querySelector("h3")).toBeNull();
    expect(screen.queryByText(/Messages \(/)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    // …and it withholds the realtime subscription end-to-end: the section
    // feeds usePhoneSync organizationId:null when the user lacks view_phone,
    // so the hook (proven by its own null-org test) opens no channel. Pins
    // against a regression where someone passes organizationId unconditionally.
    expect(sync.input?.organizationId).toBeNull();
  });

  it("shows Messages (0) and an empty-state when the job has no messages", async () => {
    asViewPhone();
    stubMessages([]);

    render(
      <JobMessagesSection
        jobId="job-1"
        organizationId="org-1"
        contacts={contacts}
      />,
    );

    expect(await screen.findByText("Messages (0)")).toBeDefined();
    expect(screen.getByText(/no (text )?messages/i)).toBeDefined();
  });
});

describe("JobMessagesSection — counterparty labels", () => {
  it("labels each message with the matching contact name, or a formatted number when unknown", async () => {
    asViewPhone();
    stubMessages([
      // inbound from a known contact → his name
      msg({
        id: "m1",
        direction: "in",
        from_e164: "+15125550001",
        to_e164: "+15125559999",
        body: "hi",
      }),
      // inbound from an unknown number → the formatted number
      msg({
        id: "m2",
        direction: "in",
        from_e164: "+15125557777",
        to_e164: "+15125559999",
        body: "yo",
      }),
    ]);

    render(
      <JobMessagesSection
        jobId="job-1"
        organizationId="org-1"
        contacts={[{ id: "c1", name: "Homer Owner", phone: "+15125550001" }]}
      />,
    );

    expect(await screen.findByText("Homer Owner")).toBeDefined();
    expect(screen.getByText("(512) 555-7777")).toBeDefined();
  });
});

describe("JobMessagesSection — Text button", () => {
  it("opens compose with the primary contact pre-filled when outbound SMS is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "true");
    asViewPhone();
    stubMessages([]);

    render(
      <JobMessagesSection
        jobId="job-1"
        organizationId="org-1"
        contacts={contacts}
      />,
    );

    await screen.findByText("Messages (0)");
    fireEvent.click(screen.getByRole("button", { name: /^text$/i }));

    expect(
      screen.getByRole("dialog", { name: /text a contact/i }),
    ).toBeDefined();
    expect(screen.getByText("Homer Owner")).toBeDefined();
  });

  it("hides the Text button when outbound SMS is disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "");
    asViewPhone();
    stubMessages([]);

    render(
      <JobMessagesSection
        jobId="job-1"
        organizationId="org-1"
        contacts={contacts}
      />,
    );

    await screen.findByText("Messages (0)");
    expect(screen.queryByRole("button", { name: /^text$/i })).toBeNull();
  });
});

describe("JobMessagesSection — send integration", () => {
  it("Text → compose → send lands the message in the section, with no chip prompt", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "true");
    asViewPhone();

    // The section's GET returns [] first, then the new outbound message
    // after the post-send refetch. The compose POST returns 201.
    let getCount = 0;
    const spy = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/phone/messages") && method === "POST") {
        return new Response(
          JSON.stringify({ id: "sent-1", status: "queued" }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }
      getCount += 1;
      const rows =
        getCount === 1
          ? []
          : [
              msg({
                id: "m-new",
                direction: "out",
                from_e164: "+15125559999",
                to_e164: "+15125550001",
                body: "On our way",
              }),
            ];
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", spy);

    render(
      <JobMessagesSection
        jobId="job-1"
        organizationId="org-1"
        contacts={contacts}
      />,
    );

    await screen.findByText("Messages (0)");
    fireEvent.click(screen.getByRole("button", { name: /^text$/i }));
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: "On our way" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send text/i }));

    // The outbound POST carried the Job smart-attach source — no chip prompt.
    await waitFor(() => {
      const post = spy.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(post).toBeDefined();
      expect(
        JSON.parse(String((post![1] as RequestInit).body)).sourceContext,
      ).toEqual({ kind: "job", jobId: "job-1" });
    });

    // After the post-send refetch the message surfaces in the section.
    expect(await screen.findByText("On our way")).toBeDefined();
    expect(screen.getByText("Messages (1)")).toBeDefined();
    expect(screen.queryByText(/tag to/i)).toBeNull();
  });
});

describe("JobMessagesSection — realtime re-tag", () => {
  it("subscribes for the org and surfaces a message re-tagged to this job on an UPDATE event", async () => {
    asViewPhone();

    // First GET: nothing tagged yet. After the re-tag UPDATE fires, the
    // refetch returns the freshly job-tagged message.
    let getCount = 0;
    const spy = vi.fn(async () => {
      getCount += 1;
      const rows =
        getCount === 1
          ? []
          : [
              msg({
                id: "m-retag",
                direction: "in",
                body: "now tagged",
                job_tag: "job-1",
              }),
            ];
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", spy);

    render(
      <JobMessagesSection
        jobId="job-1"
        organizationId="org-1"
        contacts={contacts}
      />,
    );

    await screen.findByText("Messages (0)");
    // The section wired a realtime subscription scoped to the active org.
    expect(sync.input?.organizationId).toBe("org-1");

    // A teammate re-tags an untagged Phone-tab message to this Job → the
    // UPDATE arrives over realtime and the section refetches.
    sync.input!.onMessageUpdate!({ id: "m-retag", job_tag: "job-1" });

    expect(await screen.findByText("now tagged")).toBeDefined();
    expect(screen.getByText("Messages (1)")).toBeDefined();
  });
});
