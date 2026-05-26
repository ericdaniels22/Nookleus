// /referral-partners/[id] — Call Worksheet page tests (PRD #249, issue #252).
//
// Two load-bearing rules this slice has to pin against future drift:
//
//   1. crew_member is denied at the route — fee/lifecycle data is gated to
//      admin + crew_lead (PRD #249 user story #24, mirrors slice #250).
//   2. The page never reaches outside the Active Organization. Even if a
//      crew_lead in Org A direct-navigates to a partner id that exists in
//      Org B, RLS returns no row and the page responds 404 (notFound) —
//      the same pattern jobs/estimates use for cross-tenant access.
//
// Sections-rendering is exhaustively pinned in
// `src/components/referral-partners/referral-partner-worksheet.test.tsx`;
// this file only verifies the page wires that component up correctly.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

// notFound() throws a Next.js redirect-like error in real life. The test
// just needs to detect the call so we mock it to throw a tagged error.
const NOT_FOUND_ERROR = new Error("__NOT_FOUND__");
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND_ERROR;
  },
  // The Worksheet's Delete action (issue #256) reads `useRouter()` so it can
  // navigate back to the list page after a successful soft-delete. The page-
  // render tests don't exercise the delete flow, but the hook is still
  // called on render — return a no-op router.
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

import Page from "./page";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "@/app/api/__test-utils__/request-context-fakes";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

function useUser(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

async function renderPage(id = "p-1") {
  const tree = await Page({ params: Promise.resolve({ id }) });
  return render(tree);
}

describe("/referral-partners/[id] Call Worksheet page", () => {
  it("renders an access-restricted UI for a crew_member", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "crew_member" }),
    });

    await renderPage();

    // The shared ErrorPage pattern other gated pages use (estimates/[id])
    // surfaces an "Access restricted" heading.
    expect(screen.getByText(/access restricted/i)).toBeDefined();
    // No Worksheet content should have rendered.
    expect(screen.queryByTestId("worksheet-company-info")).toBeNull();
  });

  it("calls notFound() for a partner id that doesn't resolve in the Active Organization", async () => {
    // The fake's `eq('id', ...)` filters by id; a non-matching id returns no
    // rows from .maybeSingle() — same observable behavior as RLS denying a
    // cross-org read. The page is expected to call notFound().
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "admin" }),
        referral_partners: [
          { id: "p-other-org", organization_id: "org-2", company_name: "Other Org Partner", status: "grey" },
        ],
      },
    });

    await expect(renderPage("p-1")).rejects.toThrow(NOT_FOUND_ERROR);
  });

  it("renders the Call Worksheet for an admin viewing a partner in their Active Organization", async () => {
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "admin" }),
        referral_partners: [
          {
            id: "p-1",
            organization_id: "org-1",
            company_name: "Acme Plumbing",
            status: "grey",
            industry: "Plumbing",
            lead_source: null,
            operation_size: null,
            office_phone: null,
            office_email: null,
            website: null,
            address: null,
            referral_fee_terms: null,
            notes: null,
            primary_contact_id: null,
            owner_contact_id: null,
            deleted_at: null,
          },
        ],
        contacts: [],
      },
    });

    await renderPage("p-1");

    expect(
      screen.getByRole("heading", { level: 1, name: /acme plumbing/i }),
    ).toBeDefined();
    expect(screen.getByTestId("worksheet-company-info")).toBeDefined();
    expect(screen.getByTestId("worksheet-primary-contact")).toBeDefined();
    expect(screen.getByTestId("worksheet-owner-contact")).toBeDefined();
    expect(screen.getByTestId("worksheet-contacts-list")).toBeDefined();
    expect(screen.getByTestId("worksheet-call-log")).toBeDefined();
  });

  it("renders the Worksheet for a crew_lead — the second permitted role", async () => {
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "crew_lead" }),
        referral_partners: [
          {
            id: "p-1",
            organization_id: "org-1",
            company_name: "Acme Plumbing",
            status: "grey",
          },
        ],
        contacts: [],
      },
    });

    await renderPage("p-1");

    expect(
      screen.getByRole("heading", { level: 1, name: /acme plumbing/i }),
    ).toBeDefined();
  });

  it("passes the partner's linked Primary contact + the contacts at this company through to the Worksheet", async () => {
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "admin" }),
        referral_partners: [
          {
            id: "p-1",
            organization_id: "org-1",
            company_name: "Acme Plumbing",
            status: "green",
            primary_contact_id: "c-1",
            owner_contact_id: null,
          },
        ],
        contacts: [
          {
            id: "c-1",
            full_name: "Pat Smith",
            phone: "+15555550100",
            email: "pat@acme.test",
            referral_partner_id: "p-1",
            role: "referral_contact",
          },
          {
            id: "c-2",
            full_name: "Jamie Doe",
            phone: null,
            email: null,
            referral_partner_id: "p-1",
            role: "referral_contact",
          },
          {
            id: "c-orphan",
            full_name: "Unrelated Person",
            phone: null,
            email: null,
            referral_partner_id: "p-other-partner",
            role: "referral_contact",
          },
        ],
      },
    });

    await renderPage("p-1");

    const primary = screen.getByTestId("worksheet-primary-contact");
    expect(primary.textContent).toContain("Pat Smith");

    const owner = screen.getByTestId("worksheet-owner-contact");
    expect(owner.textContent).toMatch(/not set/i);

    const contactsList = screen.getByTestId("worksheet-contacts-list");
    expect(contactsList.textContent).toContain("Pat Smith");
    expect(contactsList.textContent).toContain("Jamie Doe");
    // The contact whose referral_partner_id points elsewhere must NOT appear.
    expect(contactsList.textContent).not.toContain("Unrelated Person");
  });
});
