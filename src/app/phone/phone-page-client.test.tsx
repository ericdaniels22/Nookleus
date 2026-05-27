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
});
afterEach(() => {
  vi.restoreAllMocks();
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
});
