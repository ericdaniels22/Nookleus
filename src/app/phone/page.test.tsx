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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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
