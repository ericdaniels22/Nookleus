// PRD #304 — Nookleus Phone. Slice 4 (#308).
//
// Integration tests for the two-pane Phone-tab client component. Verifies:
//   - The conversation list renders, sorted by last_event_at desc with
//     unread on top.
//   - Selecting a conversation fetches and renders its messages.
//   - A conversation whose contact_id is NULL renders a "Save as Contact"
//     button on the thread header; clicking it POSTs and re-points the
//     conversation.
//   - For inbound messages whose contact has 2+ Active jobs, the chip
//     banner renders one chip per Active job.
//
// We mock `fetch` at the global boundary and pass the realtime hook a
// no-op `supabase` via the supabase module's `createClient`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    channel: () => ({
      on: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }),
      subscribe: () => ({ unsubscribe: () => undefined }),
      unsubscribe: () => undefined,
    }),
  }),
}));

const searchParamsMock = vi.fn<() => URLSearchParams>();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock(),
}));

import { PhonePageClient } from "./phone-page-client";

interface MockResponse {
  ok: boolean;
  status?: number;
  body: unknown;
}

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // Use globalThis to type-narrow as `unknown`, then cast at the
  // assignment site. Avoids the `any` lint hit on the `global.fetch =`
  // shorthand.
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mockFetch as never;
  // Default — no `to` query param. Each click-to-text test overrides.
  searchParamsMock.mockReturnValue(new URLSearchParams());
  // #309 ships behind a feature flag pending #305 (A2P 10DLC). UI tests
  // assume flag-ON; the flag-OFF behaviour gets its own dedicated test.
  vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "true");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function respondWith(routes: Record<string, MockResponse>) {
  mockFetch.mockImplementation(async (input: RequestInfo) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const r = routes[path];
    if (!r) throw new Error(`unmocked fetch: ${path}`);
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.body,
    };
  });
}

function convo(overrides: Record<string, unknown> = {}) {
  return {
    id: "conv-1",
    organization_id: "org-1",
    phone_number_id: "pn-1",
    outside_e164: "+15551234567",
    contact_id: null as string | null,
    contact_name: null as string | null,
    last_event_at: "2026-05-27T10:00:00Z",
    unread_count: 0,
    active_jobs: [] as Array<{ id: string; label: string }>,
    ...overrides,
  };
}

describe("PhonePageClient", () => {
  it("renders each conversation in the list, sorted by last_event_at desc with unread on top", () => {
    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({
            id: "c-old",
            outside_e164: "+15550000001",
            last_event_at: "2026-05-20T00:00:00Z",
            unread_count: 0,
          }),
          convo({
            id: "c-new",
            outside_e164: "+15550000002",
            last_event_at: "2026-05-27T00:00:00Z",
            unread_count: 0,
          }),
          convo({
            id: "c-unread",
            outside_e164: "+15550000003",
            last_event_at: "2026-05-15T00:00:00Z",
            unread_count: 3,
          }),
        ]}
      />,
    );

    const items = screen.getAllByRole("button", { name: /\(555\)/ });
    // unread on top, then by last_event_at desc
    expect(items[0].textContent).toContain("(555) 000-0003"); // unread
    expect(items[1].textContent).toContain("(555) 000-0002"); // newer
    expect(items[2].textContent).toContain("(555) 000-0001"); // older
  });

  it("renders the empty-state when there are no conversations", () => {
    render(
      <PhonePageClient organizationId="org-1" initialConversations={[]} />,
    );
    expect(
      screen.getByText(
        "No conversations yet — text or call a Contact to get started.",
      ),
    ).toBeDefined();
  });

  it("loads and renders the selected conversation's messages chronologically", async () => {
    respondWith({
      "/api/phone/conversations/conv-1/messages": {
        ok: true,
        body: [
          {
            id: "m-1",
            conversation_id: "conv-1",
            direction: "in",
            body: "Hello first",
            sent_at: "2026-05-27T10:00:00Z",
            job_tag: null,
          },
          {
            id: "m-2",
            conversation_id: "conv-1",
            direction: "out",
            body: "Hi back",
            sent_at: "2026-05-27T10:05:00Z",
            job_tag: null,
          },
        ],
      },
    });

    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[convo({ id: "conv-1" })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /\(555\) 123-4567/ }));

    await waitFor(() => {
      expect(screen.getByText("Hello first")).toBeDefined();
      expect(screen.getByText("Hi back")).toBeDefined();
    });
  });

  it("renders Save as Contact button on the header when contact_id is null", async () => {
    respondWith({
      "/api/phone/conversations/conv-1/messages": { ok: true, body: [] },
    });

    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({ id: "conv-1", contact_id: null, contact_name: null }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /\(555\)/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save as contact/i })).toBeDefined(),
    );
  });

  it("does NOT render Save as Contact when contact_id is set", async () => {
    respondWith({
      "/api/phone/conversations/conv-1/messages": { ok: true, body: [] },
    });

    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({ id: "conv-1", contact_id: "c-1", contact_name: "Alice" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /save as contact/i })).toBeNull(),
    );
  });

  // -------------------------------------------------------------------------
  // Slice 5 (#309) — compose box + send flow.
  //
  // AC bullets:
  //   - "Outbound send route: a Crew Lead can send a text to a customer;
  //      Twilio delivers it; phone_messages row exists with the right
  //      direction, body, from_e164, to_e164"
  //   - "RTL integration tests: compose box send flow, tag chips appearing
  //      for the right cases, re-tag menu"
  //
  // The compose box appears at the bottom of the thread pane whenever a
  // conversation is selected. Typing + clicking Send POSTs to
  // /api/phone/messages and appends the outbound row optimistically.
  // -------------------------------------------------------------------------

  it("renders a compose textarea + Send button when a conversation is selected", async () => {
    respondWith({
      "/api/phone/conversations/conv-1/messages": { ok: true, body: [] },
    });

    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({ id: "conv-1", contact_id: "c-1", contact_name: "Alice" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/text message/i)).toBeDefined(),
    );
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDefined();
  });

  it("posts the typed message to /api/phone/messages and appends the outbound row", async () => {
    mockFetch.mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      if (path === "/api/phone/conversations/conv-1/messages" && (!init || init.method !== "POST")) {
        return { ok: true, status: 200, json: async () => [] };
      }
      if (path === "/api/phone/messages" && init?.method === "POST") {
        const body = init.body ? JSON.parse(init.body as string) : null;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: "msg-out",
            conversationId: "conv-1",
            twilio_sid: "SM-out",
            status: "queued",
            __sentBody: body,
          }),
        };
      }
      throw new Error(`unmocked fetch: ${path} ${init?.method ?? "GET"}`);
    });

    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({ id: "conv-1", contact_id: "c-1", contact_name: "Alice" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));

    const textarea = (await screen.findByPlaceholderText(
      /text message/i,
    )) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Be there at 9 AM" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        ([, init]) =>
          (init as RequestInit | undefined)?.method === "POST" &&
          String((init as RequestInit | undefined)?.body ?? "").includes(
            "Be there at 9 AM",
          ),
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(
        (postCall![1] as RequestInit).body as string,
      ) as Record<string, unknown>;
      expect(body).toMatchObject({
        conversationId: "conv-1",
        body: "Be there at 9 AM",
      });
    });

    // The new outbound row appears in the thread.
    await waitFor(() =>
      expect(screen.getByText("Be there at 9 AM")).toBeDefined(),
    );

    // The textarea clears after send.
    expect(textarea.value).toBe("");
  });

  it("disables the Send button when the textarea is empty", async () => {
    respondWith({
      "/api/phone/conversations/conv-1/messages": { ok: true, body: [] },
    });

    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({ id: "conv-1", contact_id: "c-1", contact_name: "Alice" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));
    await screen.findByPlaceholderText(/text message/i);

    const send = screen.getByRole("button", { name: /^send$/i }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it("surfaces the server error when the opt-out gate blocks the send", async () => {
    mockFetch.mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      if (path === "/api/phone/conversations/conv-1/messages" && (!init || init.method !== "POST")) {
        return { ok: true, status: 200, json: async () => [] };
      }
      if (path === "/api/phone/messages" && init?.method === "POST") {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            error: "This number has opted out (TCPA). An admin can re-opt-in via Settings → Phone.",
          }),
        };
      }
      throw new Error(`unmocked fetch: ${path}`);
    });

    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({ id: "conv-1", contact_id: "c-1", contact_name: "Alice" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));
    const textarea = await screen.findByPlaceholderText(/text message/i);
    fireEvent.change(textarea, { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByText(/opted out/i)).toBeDefined(),
    );
  });

  // -------------------------------------------------------------------------
  // Slice 5 (#309) — + New conversation flow.
  //
  // AC: "+ New conversation lands on a fresh thread after send"
  //
  // From any state (including the empty-state) the user can hit "+ New",
  // pick a Contact (or enter a raw outside phone), type the first
  // message, and send. The route returns a conversationId; the UI then
  // selects it so the user lands on the new thread.
  // -------------------------------------------------------------------------

  it("renders a + New conversation button on the Phone page", () => {
    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[]}
      />,
    );
    expect(
      screen.getByRole("button", { name: /new conversation/i }),
    ).toBeDefined();
  });

  it("opens the + New form when the button is clicked", () => {
    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /new conversation/i }),
    );
    expect(screen.getByLabelText(/to/i)).toBeDefined();
    expect(screen.getByLabelText(/message/i)).toBeDefined();
  });

  it("posts a new-conversation message via outsideE164 and lands on the returned thread", async () => {
    mockFetch.mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      if (path === "/api/phone/messages" && init?.method === "POST") {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: "m-new",
            conversationId: "conv-new",
            twilio_sid: "SM-out",
            status: "queued",
          }),
        };
      }
      if (path === "/api/phone/conversations/conv-new/messages") {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: "m-new",
              conversation_id: "conv-new",
              direction: "out",
              body: "first message",
              sent_at: "2026-05-27T11:00:00Z",
              job_tag: null,
            },
          ],
        };
      }
      throw new Error(`unmocked fetch: ${path}`);
    });

    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /new conversation/i }),
    );
    fireEvent.change(screen.getByLabelText(/to/i), {
      target: { value: "+15558675309" },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: "first message" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(
        (postCall![1] as RequestInit).body as string,
      ) as Record<string, unknown>;
      expect(body).toMatchObject({
        outsideE164: "+15558675309",
        body: "first message",
      });
    });

    // Lands on the new thread — the message appears.
    await waitFor(() =>
      expect(screen.getByText("first message")).toBeDefined(),
    );
  });

  // Slice 5 (#309) — Per-message re-tag menu.
  //
  // AC: "Re-tag affordance: per-message menu that lets a user re-tag any
  //      message to a different Job or remove a tag. Tag changes write
  //      phone_messages.job_tag and tagged_by_user_id."

  it("offers a re-tag menu on each message that POSTs the chosen job", async () => {
    mockFetch.mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      if (
        path === "/api/phone/conversations/conv-1/messages" &&
        (!init || init.method !== "POST")
      ) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: "m-1",
              conversation_id: "conv-1",
              direction: "in",
              body: "hello",
              sent_at: "2026-05-27T10:00:00Z",
              job_tag: "job-OLD",
            },
          ],
        };
      }
      if (path === "/api/phone/messages/m-1/tag" && init?.method === "POST") {
        const body = init.body ? JSON.parse(init.body as string) : null;
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, __sentBody: body }),
        };
      }
      throw new Error(`unmocked: ${path}`);
    });

    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          {
            ...convo({
              id: "conv-1",
              contact_id: "c-1",
              contact_name: "Alice",
              active_jobs: [
                { id: "job-A", label: "WTR-2026-0001" },
                { id: "job-B", label: "FYR-2026-0005" },
              ],
            }),
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));
    await screen.findByText("hello");

    // The re-tag affordance is a button on the message; clicking opens
    // a list of the contact's Active jobs and a Remove option.
    fireEvent.click(screen.getByRole("button", { name: /retag|re-tag/i }));
    fireEvent.click(screen.getByRole("button", { name: /FYR-2026-0005/ }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(([url, init]) => {
        const u = typeof url === "string" ? url : (url as Request).url;
        return (
          u.includes("/api/phone/messages/m-1/tag") &&
          (init as RequestInit | undefined)?.method === "POST"
        );
      });
      expect(postCall).toBeDefined();
      const body = JSON.parse(
        (postCall![1] as RequestInit).body as string,
      ) as Record<string, unknown>;
      expect(body).toEqual({ jobId: "job-B" });
    });
  });

  it("offers a Remove option on the re-tag menu that POSTs jobId:null", async () => {
    mockFetch.mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      if (
        path === "/api/phone/conversations/conv-1/messages" &&
        (!init || init.method !== "POST")
      ) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: "m-1",
              conversation_id: "conv-1",
              direction: "in",
              body: "hello",
              sent_at: "2026-05-27T10:00:00Z",
              job_tag: "job-OLD",
            },
          ],
        };
      }
      if (path === "/api/phone/messages/m-1/tag" && init?.method === "POST") {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      throw new Error(`unmocked: ${path}`);
    });

    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({
            id: "conv-1",
            contact_id: "c-1",
            contact_name: "Alice",
            active_jobs: [{ id: "job-A", label: "WTR-2026-0001" }],
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));
    await screen.findByText("hello");
    fireEvent.click(screen.getByRole("button", { name: /retag|re-tag/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove tag/i }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(([url, init]) => {
        const u = typeof url === "string" ? url : (url as Request).url;
        return (
          u.includes("/api/phone/messages/m-1/tag") &&
          (init as RequestInit | undefined)?.method === "POST"
        );
      });
      const body = JSON.parse(
        (postCall![1] as RequestInit).body as string,
      ) as Record<string, unknown>;
      expect(body).toEqual({ jobId: null });
    });
  });

  // Slice 5 (#309) — Click-to-text: the Phone page reads `?to=<E.164>`
  // and pre-opens the New Conversation form with that recipient.
  it("opens the New Conversation form prefilled when ?to=<E.164> is in the URL", () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("to=%2B15558675309"));

    render(
      <PhonePageClient organizationId="org-1" initialConversations={[]} />,
    );

    const to = screen.getByLabelText(/to/i) as HTMLInputElement;
    expect(to.value).toBe("+15558675309");
  });

  it("renders prompt chips above an untagged inbound message when contact has 2+ Active jobs", async () => {
    respondWith({
      "/api/phone/conversations/conv-1/messages": {
        ok: true,
        body: [
          {
            id: "m-untagged",
            conversation_id: "conv-1",
            direction: "in",
            body: "ambiguous",
            sent_at: "2026-05-27T10:00:00Z",
            job_tag: null,
          },
        ],
      },
    });

    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({
            id: "conv-1",
            contact_id: "c-1",
            contact_name: "Alice",
            active_jobs: [
              { id: "job-1", label: "WTR-2026-0001" },
              { id: "job-2", label: "FYR-2026-0005" },
            ],
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /WTR-2026-0001/ }),
      ).toBeDefined();
      expect(
        screen.getByRole("button", { name: /FYR-2026-0005/ }),
      ).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Slice 5 (#309) — feature-flag-OFF behaviour. #309 is blocked by #305
  // (A2P 10DLC). Until that clears, the outbound surface is hidden: no
  // compose box, no + New conversation button, no per-message re-tag
  // menu (which would imply a still-mutable outbound state). The read
  // path remains visible — STOP-handled customers + slice 4 inbound
  // history are still useful.
  // -------------------------------------------------------------------------

  it("hides the compose box when NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "");
    respondWith({
      "/api/phone/conversations/conv-1/messages": { ok: true, body: [] },
    });

    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({ id: "conv-1", contact_id: "c-1", contact_name: "Alice" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));
    // The thread still renders, but the compose textarea is absent.
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/text message/i)).toBeNull();
    });
  });

  it("hides the + New conversation button when the flag is off", () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "");
    render(
      <PhonePageClient organizationId="org-1" initialConversations={[]} />,
    );
    expect(
      screen.queryByRole("button", { name: /new conversation/i }),
    ).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Slice 6 (#310) — MMS attachments.
  //
  // Drag-and-drop + file-picker stage attachments inline above the compose
  // textarea; previews carry a remove-X; the Send button is gated on
  // (text || attachments); inline thread images render from the
  // attachments signed URL; non-image media shows as a download chip.
  // ---------------------------------------------------------------------------

  beforeEach(() => {
    // jsdom has no object-URL support; the compose strip uses one per preview.
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  });

  function imageFile(name = "damage.jpg", size = 1000): File {
    return new File([new Uint8Array(size)], name, { type: "image/jpeg" });
  }

  function attachmentRoutesFor(convId: string) {
    return async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      // Thread fetch.
      if (
        path === `/api/phone/conversations/${convId}/messages` &&
        (!init || init.method !== "POST")
      ) {
        return { ok: true, status: 200, json: async () => [] };
      }
      // Pre-upload — stages the attachment in the bucket and returns
      // the storage path the client then sends to /api/phone/messages.
      if (path === "/api/phone/attachments" && init?.method === "POST") {
        const form = init.body as FormData;
        const file = form.get("file") as File;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            attachment: {
              kind: "image",
              media_type: "image/jpeg",
              storage_path: `org-1/${file.name}.uuid.jpg`,
              filename: file.name,
            },
          }),
        };
      }
      // Outbound send.
      if (path === "/api/phone/messages" && init?.method === "POST") {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: "msg-out",
            conversationId: convId,
            twilio_sid: "SM-mms",
            status: "queued",
          }),
        };
      }
      // Signed-URL for thread render (slice 6).
      if (path.startsWith("/api/phone/attachments?path=")) {
        const stored = decodeURIComponent(path.split("path=")[1]);
        return {
          ok: true,
          status: 200,
          json: async () => ({ url: `https://signed.example/${stored}` }),
        };
      }
      throw new Error(`unmocked fetch: ${path} ${init?.method ?? "GET"}`);
    };
  }

  it("renders an Attach button in the compose box", async () => {
    respondWith({
      "/api/phone/conversations/conv-1/messages": { ok: true, body: [] },
    });
    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({ id: "conv-1", contact_id: "c-1", contact_name: "Alice" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));
    await screen.findByPlaceholderText(/text message/i);
    expect(screen.getByRole("button", { name: /attach/i })).toBeDefined();
  });

  it("uploads a picked file via /api/phone/attachments and shows a preview with a remove-X", async () => {
    mockFetch.mockImplementation(attachmentRoutesFor("conv-1"));

    const { container } = render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({ id: "conv-1", contact_id: "c-1", contact_name: "Alice" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));
    await screen.findByPlaceholderText(/text message/i);

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [imageFile("photo.jpg")] } });

    await waitFor(() => {
      expect(screen.getByAltText("photo.jpg")).toBeDefined();
    });
    expect(
      screen.getByRole("button", { name: /remove attachment/i }),
    ).toBeDefined();
  });

  it("stages a drag-and-dropped file the same way as the file picker", async () => {
    mockFetch.mockImplementation(attachmentRoutesFor("conv-1"));
    const { container } = render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({ id: "conv-1", contact_id: "c-1", contact_name: "Alice" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));
    await screen.findByPlaceholderText(/text message/i);

    const dropzone = container.querySelector('[data-dropzone="phone-compose"]')!;
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [imageFile("dropped.jpg")] },
    });

    await waitFor(() => {
      expect(screen.getByAltText("dropped.jpg")).toBeDefined();
    });
  });

  it("rejects an oversize file with a clear inline error and does NOT upload it", async () => {
    mockFetch.mockImplementation(attachmentRoutesFor("conv-1"));
    const { container } = render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({ id: "conv-1", contact_id: "c-1", contact_name: "Alice" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));
    await screen.findByPlaceholderText(/text message/i);

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    // 5 MB + 1 — past Twilio's per-MMS ceiling.
    fireEvent.change(fileInput, {
      target: { files: [imageFile("huge.jpg", 5 * 1024 * 1024 + 1)] },
    });

    await screen.findByText(/too large/i);
    // No preview, no upload POST.
    expect(screen.queryByAltText("huge.jpg")).toBeNull();
    const uploadPost = mockFetch.mock.calls.find(
      ([, init]) =>
        (init as RequestInit | undefined)?.method === "POST" &&
        (typeof init === "object"
          ? init?.body instanceof FormData
          : false),
    );
    expect(uploadPost).toBeUndefined();
  });

  it("enables Send when only attachments are staged (image-only MMS)", async () => {
    mockFetch.mockImplementation(attachmentRoutesFor("conv-1"));
    const { container } = render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({ id: "conv-1", contact_id: "c-1", contact_name: "Alice" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));
    await screen.findByPlaceholderText(/text message/i);

    const send = screen.getByRole("button", {
      name: /^send$/i,
    }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [imageFile("p.jpg")] } });

    await waitFor(() => expect(send.disabled).toBe(false));
  });

  it("POSTs attachments[] to /api/phone/messages and renders the outbound row inline", async () => {
    mockFetch.mockImplementation(attachmentRoutesFor("conv-1"));
    const { container } = render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({ id: "conv-1", contact_id: "c-1", contact_name: "Alice" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));
    await screen.findByPlaceholderText(/text message/i);

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [imageFile("p.jpg")] } });

    await waitFor(() => expect(screen.getByAltText("p.jpg")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      const sendCall = mockFetch.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith("/api/phone/messages") &&
          (init as RequestInit | undefined)?.method === "POST",
      );
      expect(sendCall).toBeDefined();
      const body = JSON.parse(
        (sendCall![1] as RequestInit).body as string,
      ) as { attachments: Array<{ storage_path: string }> };
      expect(body.attachments).toHaveLength(1);
      expect(body.attachments[0].storage_path).toBe("org-1/p.jpg.uuid.jpg");
    });
  });
});

// ---------------------------------------------------------------------------
// Slice 6 (#310) — thread render of attachments.
// ---------------------------------------------------------------------------

describe("PhonePageClient — thread media render (#310)", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:mock");
  });

  function setupMediaThread(media_urls: Array<Record<string, string>>) {
    mockFetch.mockImplementation(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      if (path === "/api/phone/conversations/conv-mms/messages") {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: "m-1",
              conversation_id: "conv-mms",
              direction: "in",
              body: "",
              sent_at: "2026-05-27T10:00:00Z",
              job_tag: null,
              media_urls,
            },
          ],
        };
      }
      if (path.startsWith("/api/phone/attachments?path=")) {
        const stored = decodeURIComponent(path.split("path=")[1]);
        return {
          ok: true,
          status: 200,
          json: async () => ({ url: `https://signed.example/${stored}` }),
        };
      }
      throw new Error(`unmocked fetch: ${path}`);
    });
  }

  it("renders an inline image thumbnail for image attachments", async () => {
    setupMediaThread([
      { storage_path: "org-1/in.jpg", media_type: "image/jpeg" },
    ]);

    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          {
            id: "conv-mms",
            organization_id: "org-1",
            phone_number_id: "pn-1",
            outside_e164: "+15551112222",
            contact_id: "c-1",
            contact_name: "Alice",
            last_event_at: "2026-05-27T10:00:00Z",
            unread_count: 0,
            active_jobs: [],
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));

    const thumb = (await screen.findByRole("img", {
      name: /attachment/i,
    })) as HTMLImageElement;
    await waitFor(() => expect(thumb.src).toContain("signed.example"));
    expect(thumb.src).toContain("org-1/in.jpg");
  });

  it("renders a downloadable filename link for non-image attachments", async () => {
    setupMediaThread([
      {
        storage_path: "org-1/estimate.pdf",
        media_type: "application/pdf",
        filename: "estimate.pdf",
      },
    ]);

    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          {
            id: "conv-mms",
            organization_id: "org-1",
            phone_number_id: "pn-1",
            outside_e164: "+15551112222",
            contact_id: "c-1",
            contact_name: "Alice",
            last_event_at: "2026-05-27T10:00:00Z",
            unread_count: 0,
            active_jobs: [],
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));

    const link = (await screen.findByRole("link", {
      name: /estimate\.pdf/i,
    })) as HTMLAnchorElement;
    await waitFor(() => expect(link.href).toContain("estimate.pdf"));
  });
});

// ---------------------------------------------------------------------------
// Slice 8 (#312) — voice calls in the thread.
//
// A call threads on the same conversation as the texts. The thread fetches
// /calls alongside /messages and interleaves them chronologically
// (mergeThreadItems). A call row shows a direction icon, the status, the
// duration when known, and the time. Clicking it opens the slice-11
// placeholder (call detail/recording lands later).
// ---------------------------------------------------------------------------

describe("PhonePageClient — call events (#312)", () => {
  function setupThread(opts: {
    messages?: Array<Record<string, unknown>>;
    calls?: Array<Record<string, unknown>>;
  }) {
    mockFetch.mockImplementation(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      if (path === "/api/phone/conversations/conv-1/messages") {
        return { ok: true, status: 200, json: async () => opts.messages ?? [] };
      }
      if (path === "/api/phone/conversations/conv-1/calls") {
        return { ok: true, status: 200, json: async () => opts.calls ?? [] };
      }
      throw new Error(`unmocked fetch: ${path}`);
    });
  }

  it("interleaves a voice call into the thread chronologically with messages", async () => {
    setupThread({
      messages: [
        {
          id: "m-1",
          conversation_id: "conv-1",
          direction: "out",
          body: "Hi back",
          sent_at: "2026-05-27T10:05:00Z",
          job_tag: null,
        },
      ],
      calls: [
        {
          id: "call-1",
          conversation_id: "conv-1",
          direction: "in",
          status: "completed",
          duration_seconds: 42,
          started_at: "2026-05-27T10:00:00Z",
          ended_at: "2026-05-27T10:00:42Z",
        },
      ],
    });

    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({ id: "conv-1", contact_id: "c-1", contact_name: "Alice" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));

    const callRow = await screen.findByText(/incoming call/i);
    const message = screen.getByText("Hi back");
    // The call started at 10:00, the text at 10:05 — the call row renders
    // before the message bubble in the DOM.
    expect(
      callRow.compareDocumentPosition(message) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows a call's status, with its duration only when the call has one", async () => {
    setupThread({
      messages: [],
      calls: [
        {
          id: "call-done",
          conversation_id: "conv-1",
          direction: "in",
          status: "completed",
          duration_seconds: 125,
          started_at: "2026-05-27T10:00:00Z",
          ended_at: "2026-05-27T10:02:05Z",
        },
        {
          id: "call-ringing",
          conversation_id: "conv-1",
          direction: "in",
          status: "ringing",
          duration_seconds: null,
          started_at: "2026-05-27T10:05:00Z",
          ended_at: null,
        },
      ],
    });

    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({ id: "conv-1", contact_id: "c-1", contact_name: "Alice" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));

    // Both calls carry a human-readable status…
    expect(await screen.findByText("Completed")).toBeDefined();
    expect(screen.getByText("Ringing")).toBeDefined();
    // …but only the completed call shows a duration (mm:ss); the ringing
    // call has none yet, so exactly one duration timecode is present.
    const durations = screen.getAllByText(/^\d+:\d{2}$/);
    expect(durations).toHaveLength(1);
    expect(durations[0].textContent).toBe("2:05");
  });

  it("uses a distinct direction icon for incoming vs outgoing calls", async () => {
    setupThread({
      messages: [],
      calls: [
        {
          id: "c-in",
          conversation_id: "conv-1",
          direction: "in",
          status: "completed",
          duration_seconds: 10,
          started_at: "2026-05-27T10:00:00Z",
          ended_at: "2026-05-27T10:00:10Z",
        },
        {
          id: "c-out",
          conversation_id: "conv-1",
          direction: "out",
          status: "completed",
          duration_seconds: 20,
          started_at: "2026-05-27T10:05:00Z",
          ended_at: "2026-05-27T10:05:20Z",
        },
      ],
    });

    const { container } = render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({ id: "conv-1", contact_id: "c-1", contact_name: "Alice" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));
    await screen.findByText(/incoming call/i);

    // An inbound call gets an incoming-call glyph; an outbound call an
    // outgoing-call glyph — the icon reinforces the textual direction.
    expect(container.querySelector(".lucide-phone-incoming")).not.toBeNull();
    expect(container.querySelector(".lucide-phone-outgoing")).not.toBeNull();
  });

  it("shows the call's start time", async () => {
    const startedAt = "2026-05-27T18:30:00Z";
    setupThread({
      messages: [],
      calls: [
        {
          id: "c-time",
          conversation_id: "conv-1",
          direction: "in",
          status: "completed",
          duration_seconds: 7,
          started_at: startedAt,
          ended_at: "2026-05-27T18:30:07Z",
        },
      ],
    });

    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({ id: "conv-1", contact_id: "c-1", contact_name: "Alice" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));
    await screen.findByText(/incoming call/i);

    // The start time renders as a local clock time. Compute the expected
    // string the same way so the assertion is timezone-agnostic, and
    // normalize whitespace (Intl can emit a narrow no-break space).
    const expected = new Date(startedAt).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    expect(
      screen.getByText((content) => norm(content) === norm(expected)),
    ).toBeDefined();
  });

  it("opens a slice-11 recording placeholder when a call row is clicked", async () => {
    setupThread({
      messages: [],
      calls: [
        {
          id: "c-click",
          conversation_id: "conv-1",
          direction: "in",
          status: "completed",
          duration_seconds: 30,
          started_at: "2026-05-27T10:00:00Z",
          ended_at: "2026-05-27T10:00:30Z",
        },
      ],
    });

    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[
          convo({ id: "conv-1", contact_id: "c-1", contact_name: "Alice" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));
    const callRow = await screen.findByText(/incoming call/i);

    // Nothing about slice 11 until the row is clicked…
    expect(screen.queryByText(/slice 11/i)).toBeNull();
    // …recording playback ships in slice 11, so for now the click reveals
    // a placeholder pointing there (AC: "Click on a row opens a future
    // placeholder").
    fireEvent.click(callRow);
    expect(await screen.findByText(/slice 11/i)).toBeDefined();
  });
});
