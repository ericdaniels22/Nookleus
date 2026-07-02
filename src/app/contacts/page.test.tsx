// Contacts tab — Referral Contact badge (PRD #249, issue #255 AC #4).
//
// Mounts the Contacts page and asserts that a contact whose `role` is
// `referral_contact` renders a clear "Referral Contact" badge — visually
// consistent with the existing role badges (homeowner, adjuster,
// insurance, etc.). The list / search / phone-format infrastructure is
// reused; no parallel code path.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(async () => "org-1"),
}));

import ContactsPage from "./page";
import { createClient } from "@/lib/supabase";

type Row = Record<string, unknown>;

function fakeQueryBuilder(rows: Row[]) {
  let filtered = [...rows];
  const passthrough = () => builder;
  const builder = {
    select: passthrough,
    eq(col: string, val: unknown) {
      filtered = filtered.filter((r) => r[col] === val);
      return builder;
    },
    order: passthrough,
    then(resolve: (v: { data: Row[]; error: null }) => unknown) {
      return resolve({ data: filtered, error: null });
    },
  };
  return builder;
}

function useTables(tables: Record<string, Row[]>) {
  vi.mocked(createClient).mockReturnValue({
    from(table: string) {
      return fakeQueryBuilder(tables[table] ?? []);
    },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/contacts — Referral Contact badge (issue #255 AC #4)", () => {
  it("renders a 'Referral Contact' badge on rows with role = 'referral_contact'", async () => {
    useTables({
      contacts: [
        {
          id: "c-1",
          organization_id: "org-1",
          full_name: "Pat Referral",
          phone: null,
          email: null,
          role: "referral_contact",
          company: null,
          notes: null,
          created_at: "2026-05-01T00:00:00Z",
          updated_at: "2026-05-01T00:00:00Z",
        },
      ],
      jobs: [],
    });

    render(<ContactsPage />);

    await waitFor(() => {
      expect(screen.getByText(/pat referral/i)).toBeDefined();
    });
    // The badge text must call out "Referral Contact" so the user can
    // distinguish a Referral Partner contact from a homeowner / adjuster
    // / insurance rep at a glance.
    expect(screen.getByText(/referral contact/i)).toBeDefined();
  });

  it("uses the same row layout for Referral Contacts as for other roles (no parallel code path)", async () => {
    useTables({
      contacts: [
        {
          id: "c-1",
          organization_id: "org-1",
          full_name: "Hannah Homeowner",
          phone: "+15551110001",
          email: null,
          role: "homeowner",
          company: null,
          notes: null,
          created_at: "2026-05-01T00:00:00Z",
          updated_at: "2026-05-01T00:00:00Z",
        },
        {
          id: "c-2",
          organization_id: "org-1",
          full_name: "Riley Referral",
          phone: "+15551110002",
          email: null,
          role: "referral_contact",
          company: null,
          notes: null,
          created_at: "2026-05-01T00:00:00Z",
          updated_at: "2026-05-01T00:00:00Z",
        },
      ],
      jobs: [],
    });

    render(<ContactsPage />);

    await waitFor(() => {
      expect(screen.getByText(/riley referral/i)).toBeDefined();
    });
    // Phone-format infrastructure works on Referral Contacts identically.
    expect(screen.getByText(/\(555\) 111-0002/)).toBeDefined();
    expect(screen.getByText(/\(555\) 111-0001/)).toBeDefined();
  });
});

describe("/contacts — initials avatar (design-system §5, issue #921)", () => {
  it("shows an initials avatar labelled with each contact's name", async () => {
    useTables({
      contacts: [
        {
          id: "c-1",
          organization_id: "org-1",
          full_name: "Hannah Homeowner",
          phone: null,
          email: null,
          role: "homeowner",
          company: null,
          notes: null,
          created_at: "2026-05-01T00:00:00Z",
          updated_at: "2026-05-01T00:00:00Z",
        },
      ],
      jobs: [],
    });

    render(<ContactsPage />);

    // §5: list rows carry an initials avatar (monogram on the overlay
    // circle). The full name is the avatar's accessible label, so it reads
    // as an image to assistive tech and shows "HH" to sighted users.
    const avatar = await screen.findByRole("img", { name: "Hannah Homeowner" });
    expect(avatar.textContent).toBe("HH");
  });
});
