// PRD #304 — Nookleus Phone. Slice 2 (#306).
//
// Pins two AC bullets at the page level:
//   1. A caller with `view_phone` lands on the empty-state surface and sees
//      "No conversations yet — text or call a Contact to get started."
//   2. A caller without `view_phone` is denied — the shared "Access
//      restricted" surface from the estimates/[id] / invoices/[id] / referral-
//      partners/[id] pages.
//
// The page itself is a Server Component that calls `requirePagePermission`
// to gate the surface and render `<ErrorPage>` on denial — the standard
// unauthorized response in this codebase. We render the page via
// `await Page({})` (the referral-partners/[id] page test pattern).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));
// Slice 4 — PhonePageClient instantiates the browser Supabase client for
// the realtime subscription. The tests don't exercise realtime; this stub
// keeps `createClient()` from reading process.env at module-eval time.
// The realtime hook chains `.on()` once per subscription (phone_messages
// INSERT, message UPDATE, phone_calls INSERT/UPDATE since slice 10, and
// phone_voicemails UPDATE since slice 9), so `.on()` must return the channel
// itself to stay chainable — a non-chainable stub breaks the moment a second
// `.on()` fires.
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    channel: () => {
      const ch: {
        on: () => typeof ch;
        subscribe: () => { unsubscribe: () => void };
        unsubscribe: () => void;
      } = {
        on: () => ch,
        subscribe: () => ({ unsubscribe: () => undefined }),
        unsubscribe: () => undefined,
      };
      return ch;
    },
  }),
}));

import PhonePage from "./page";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { fakeUserClient, memberTables } from "@/app/api/__test-utils__/request-context-fakes";

function useUser(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function renderPage() {
  const tree = await PhonePage();
  return render(tree);
}

describe("/phone — empty-state surface (PRD #304 / #306)", () => {
  it("renders the empty-state copy for a crew_lead holding view_phone", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["view_phone"],
      }),
    });

    await renderPage();

    expect(
      screen.getByText(
        "No conversations yet — text or call a Contact to get started.",
      ),
    ).toBeDefined();
  });

  it("renders the empty-state copy for an admin (auto-passes the gate)", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "admin" }),
    });

    await renderPage();

    expect(
      screen.getByText(
        "No conversations yet — text or call a Contact to get started.",
      ),
    ).toBeDefined();
  });

  it("renders the access-restricted surface for a crew_member without view_phone", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "crew_member" }),
    });

    await renderPage();

    // Shared ErrorPage pattern across gated routes (estimates/[id],
    // invoices/[id], referral-partners/[id]).
    expect(screen.getByText(/access restricted/i)).toBeDefined();
    // The empty-state surface should not have rendered.
    expect(
      screen.queryByText(
        "No conversations yet — text or call a Contact to get started.",
      ),
    ).toBeNull();
  });
});

describe("/phone — per-message Send-from picker (slice 13, #317)", () => {
  // The server page loads the org's phone_numbers and computes the caller's
  // permitted send-from set (own Personal + Shared) via the same pure rule the
  // send route applies, then hands it to the client as `selectableNumbers`.
  // Opening the new-conversation composer surfaces that set as the "Send from"
  // picker. A teammate's Personal number is never offered — sending from it
  // would impersonate them and cross the ADR 0005 content-privacy boundary.
  it("offers own Personal + Shared, own Personal first, excluding a teammate's Personal", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "true");
    useUser({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["view_phone"],
        extraTables: {
          phone_numbers: [
            {
              id: "pn-shared",
              organization_id: "org-1",
              e164: "+15125550000",
              kind: "shared",
              user_id: null,
              released_at: null,
              is_active: true,
              created_at: "2026-01-01T00:00:00Z",
            },
            {
              id: "pn-personal",
              organization_id: "org-1",
              e164: "+15125559999",
              kind: "personal",
              user_id: "user-1",
              released_at: null,
              is_active: true,
              created_at: "2026-02-01T00:00:00Z",
            },
            {
              id: "pn-teammate",
              organization_id: "org-1",
              e164: "+15125558888",
              kind: "personal",
              user_id: "user-2",
              released_at: null,
              is_active: true,
              created_at: "2026-03-01T00:00:00Z",
            },
          ],
        },
      }),
    });

    await renderPage();

    // Empty state → outbound enabled → "New conversation" opens the composer.
    fireEvent.click(
      screen.getByRole("button", { name: /new conversation/i }),
    );

    const picker = screen.getByLabelText("Send from") as HTMLSelectElement;
    expect(Array.from(picker.options).map((o) => o.value)).toEqual([
      "pn-personal",
      "pn-shared",
    ]);
  });
});
