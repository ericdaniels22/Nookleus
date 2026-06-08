// PRD #304 — Nookleus Phone. Slice 10 (#314) — outbound bridge calling.
//
// The headline RTL integration test: a Crew Lead clicks **Call** in the
// Phone-tab thread; an in-flight call row appears immediately (queued);
// then the (mocked) status-callback fires a phone_calls UPDATE over
// realtime and the row advances to "Completed". This is the
// "Call button → in-flight row in thread → status updates to completed on
// hangup" acceptance criterion.
//
// Unlike the SMS compose box, the Call button has NO A2P 10DLC feature-flag
// gate — voice carries no 10DLC dependency, so Call surfaces wherever the
// Phone tab (view_phone) does, flag on or off.
//
// `usePhoneSync` is mocked so the test can drive the realtime callbacks
// directly (the same capture-the-input pattern the Job-page section test
// uses); fetch is stubbed at the global boundary.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import type { UsePhoneSyncInput } from "@/lib/phone/use-phone-sync";

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

// Capture the latest usePhoneSync input so the test can fire onCallUpdate /
// onNewCall as if the status-callback webhook had advanced the row.
const sync: { input?: UsePhoneSyncInput } = {};
vi.mock("@/lib/phone/use-phone-sync", () => ({
  usePhoneSync: (input: UsePhoneSyncInput) => {
    sync.input = input;
  },
}));

import { PhonePageClient } from "./phone-page-client";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  sync.input = undefined;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mockFetch as never;
  searchParamsMock.mockReturnValue(new URLSearchParams());
  vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "true");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function convo(overrides: Record<string, unknown> = {}) {
  return {
    id: "conv-1",
    organization_id: "org-1",
    phone_number_id: "pn-1",
    outside_e164: "+15551234567",
    contact_id: "c-1" as string | null,
    contact_name: "Alice" as string | null,
    last_event_at: "2026-05-27T10:00:00Z",
    unread_count: 0,
    active_jobs: [] as Array<{ id: string; label: string }>,
    ...overrides,
  };
}

// GET messages/calls empty; POST /api/phone/calls returns a queued row.
function callRoutes(
  postResult: { ok: boolean; status: number; body: unknown },
) {
  mockFetch.mockImplementation(
    async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      if (path === "/api/phone/conversations/conv-1/messages") {
        return { ok: true, status: 200, json: async () => [] };
      }
      if (path === "/api/phone/conversations/conv-1/calls") {
        return { ok: true, status: 200, json: async () => [] };
      }
      if (path === "/api/phone/calls" && init?.method === "POST") {
        return {
          ok: postResult.ok,
          status: postResult.status,
          json: async () => postResult.body,
        };
      }
      throw new Error(`unmocked fetch: ${path} ${init?.method ?? "GET"}`);
    },
  );
}

async function openThread() {
  render(
    <PhonePageClient
      organizationId="org-1"
      initialConversations={[convo({ id: "conv-1" })]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /alice/i }));
  await screen.findByPlaceholderText(/text message/i);
}

describe("PhonePageClient — outbound call lifecycle (#314)", () => {
  it("clicking Call posts to /api/phone/calls, shows an in-flight row, then advances to Completed on the status-callback UPDATE", async () => {
    callRoutes({
      ok: true,
      status: 201,
      body: {
        id: "call-out",
        conversationId: "conv-1",
        twilio_call_sid: "CA-1",
        status: "queued",
        smartAttach: { kind: "untagged" },
      },
    });

    await openThread();

    // The Call button is in the thread header.
    fireEvent.click(screen.getByRole("button", { name: /^call$/i }));

    // It posts to the bridge-call route from the open thread (phone-tab).
    await waitFor(() => {
      const post = mockFetch.mock.calls.find(
        ([u, init]) =>
          String(u).endsWith("/api/phone/calls") &&
          (init as RequestInit | undefined)?.method === "POST",
      );
      expect(post).toBeDefined();
      const body = JSON.parse((post![1] as RequestInit).body as string);
      expect(body).toMatchObject({
        conversationId: "conv-1",
        sourceContext: { kind: "phone-tab" },
      });
    });

    // The in-flight outbound call row appears immediately, queued.
    await screen.findByText(/outgoing call/i);
    expect(screen.getByText("Queued")).toBeDefined();

    // The (mocked) status-callback webhook advances the phone_calls row;
    // the realtime UPDATE flips the in-flight row to Completed with a
    // duration. usePhoneSync is mocked, so fire its onCallUpdate directly.
    expect(sync.input?.onCallUpdate).toBeTypeOf("function");
    act(() => {
      sync.input!.onCallUpdate!({
        id: "call-out",
        organization_id: "org-1",
        conversation_id: "conv-1",
        direction: "out",
        status: "completed",
        duration_seconds: 30,
        started_at: "2026-05-27T10:00:00Z",
        ended_at: "2026-05-27T10:00:30Z",
      });
    });

    await waitFor(() => expect(screen.getByText("Completed")).toBeDefined());
    // Duration now renders (0:30) and the queued label is gone.
    expect(screen.getByText("0:30")).toBeDefined();
    expect(screen.queryByText("Queued")).toBeNull();
  });

  it("does not duplicate the in-flight row when the realtime INSERT echo arrives before the POST resolves", async () => {
    // The mirror of onNewCall's own guard: there the optimistic insert beats
    // the echo; here the echo beats the optimistic insert. onCall's append
    // must dedupe on id, or the same call shows twice until a refetch.
    let resolvePost: (() => void) | undefined;
    const postPending = new Promise<void>((r) => {
      resolvePost = r;
    });
    mockFetch.mockImplementation(
      async (input: RequestInfo, init?: RequestInit) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        const path = url.replace(/^https?:\/\/[^/]+/, "");
        if (path === "/api/phone/conversations/conv-1/messages") {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (path === "/api/phone/conversations/conv-1/calls") {
          return { ok: true, status: 200, json: async () => [] };
        }
        if (path === "/api/phone/calls" && init?.method === "POST") {
          await postPending;
          return {
            ok: true,
            status: 201,
            json: async () => ({
              id: "call-out",
              conversationId: "conv-1",
              twilio_call_sid: "CA-1",
              status: "queued",
              smartAttach: { kind: "untagged" },
            }),
          };
        }
        throw new Error(`unmocked fetch: ${path} ${init?.method ?? "GET"}`);
      },
    );

    await openThread();
    fireEvent.click(screen.getByRole("button", { name: /^call$/i }));

    // Realtime INSERT echo for our own outbound row lands while the POST is
    // still in flight — it appends the row (its dedupe sees nothing yet).
    expect(sync.input?.onNewCall).toBeTypeOf("function");
    act(() => {
      sync.input!.onNewCall!({
        id: "call-out",
        organization_id: "org-1",
        conversation_id: "conv-1",
        direction: "out",
        status: "queued",
        duration_seconds: null,
        started_at: "2026-05-27T10:00:00Z",
        ended_at: null,
      });
    });
    await screen.findByText(/outgoing call/i);

    // Now the POST resolves; onCall's optimistic insert must see the echoed
    // row and dedupe rather than appending a second copy.
    await act(async () => {
      resolvePost!();
      await postPending;
    });

    await waitFor(() =>
      expect(screen.getAllByText(/outgoing call/i)).toHaveLength(1),
    );
  });

  it("surfaces the profile-cell error (422) and places no in-flight row when the caller has no cell", async () => {
    callRoutes({
      ok: false,
      status: 422,
      body: {
        error:
          "Add a mobile number to your profile before placing a call — it is the phone we ring first.",
      },
    });

    await openThread();
    fireEvent.click(screen.getByRole("button", { name: /^call$/i }));

    await waitFor(() =>
      expect(screen.getByText(/add a mobile number to your profile/i)).toBeDefined(),
    );
    // No call row was added.
    expect(screen.queryByText(/outgoing call/i)).toBeNull();
  });

  it("shows the Call button even when outbound SMS is flag-gated off (voice has no A2P dependency)", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "");
    mockFetch.mockImplementation(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      if (path === "/api/phone/conversations/conv-1/messages") {
        return { ok: true, status: 200, json: async () => [] };
      }
      if (path === "/api/phone/conversations/conv-1/calls") {
        return { ok: true, status: 200, json: async () => [] };
      }
      throw new Error(`unmocked fetch: ${path}`);
    });

    render(
      <PhonePageClient
        organizationId="org-1"
        initialConversations={[convo({ id: "conv-1" })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /alice/i }));

    // Compose box is hidden (SMS gated)…
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/text message/i)).toBeNull(),
    );
    // …but the Call button is present.
    expect(screen.getByRole("button", { name: /^call$/i })).toBeDefined();
  });
});
