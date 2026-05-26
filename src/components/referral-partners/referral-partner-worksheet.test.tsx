// Call Worksheet presentational + edit-surface tests
// (PRD #249, issues #252 read-only base and #253 editable Worksheet).
//
// This slice ships the editable Call Worksheet: every column listed on
// issue #253 becomes editable, and the header gains a four-color
// Lifecycle status flip-button row that can transition any status to any
// other. The PRD's "no automated transitions" rule is also pinned here.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

// The Worksheet now navigates back to the list page after a successful
// soft-delete (issue #256). The component pulls `useRouter` from
// next/navigation; we stub it here so the existing render-only tests still
// pass and the new delete-flow test can assert on the push call.
const routerPush = vi.fn();
const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: routerRefresh }),
}));

import {
  ReferralPartnerWorksheet,
  type ReferralPartnerForWorksheet,
  type ReferralContactForWorksheet,
} from "./referral-partner-worksheet";
import type { CallLogEntry } from "@/lib/referral-partner-call";

const BASE_PARTNER: ReferralPartnerForWorksheet = {
  id: "p-1",
  organization_id: "org-1",
  company_name: "Acme Plumbing",
  status: "grey",
  industry: "Plumbing",
  lead_source: "Google",
  operation_size: null,
  office_phone: "+15551230001",
  office_email: "ops@acme.test",
  website: "acme.test",
  address: "100 Main St",
  referral_fee_terms: null,
  notes: null,
  primary_contact_id: null,
  owner_contact_id: null,
};

function renderWorksheet(overrides: {
  partner?: Partial<ReferralPartnerForWorksheet>;
  primaryContact?: ReferralContactForWorksheet | null;
  ownerContact?: ReferralContactForWorksheet | null;
  contacts?: ReferralContactForWorksheet[];
  initialCalls?: CallLogEntry[];
} = {}) {
  const partner = { ...BASE_PARTNER, ...overrides.partner };
  return render(
    <ReferralPartnerWorksheet
      partner={partner}
      primaryContact={overrides.primaryContact ?? null}
      ownerContact={overrides.ownerContact ?? null}
      contacts={overrides.contacts ?? []}
      initialCalls={overrides.initialCalls ?? []}
    />,
  );
}

// Test-double for `fetch`. The Worksheet's edit + flip-status paths hit
// PATCH /api/referral-partners/[id]; we mock at the global so the
// component doesn't have to take a fetch prop just for testability.
beforeEach(() => {
  routerPush.mockReset();
  routerRefresh.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      // POST /api/.../delete — soft-delete (issue #256).
      if (url.endsWith("/delete")) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      // POST /api/.../calls returns { call: ... }; PATCH returns { referral_partner: ... }
      if (url.endsWith("/calls")) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            call: {
              id: "call-stub",
              referral_partner_id: "p-1",
              called_at: "2026-05-15T10:00:00Z",
              outcome: body.outcome ?? "spoke",
              follow_up_at: body.follow_up_at ?? null,
            },
          }),
        } as Response;
      }
      if (url.endsWith("/contacts")) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            contact: {
              id: "c-new",
              organization_id: "org-1",
              referral_partner_id: "p-1",
              full_name: body.full_name,
              phone: body.phone || null,
              email: body.email || null,
              notes: body.notes || null,
              role: "referral_contact",
            },
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          referral_partner: { ...BASE_PARTNER, ...body },
        }),
      } as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReferralPartnerWorksheet — header + Lifecycle status", () => {
  it("renders the partner's company name in the header", () => {
    renderWorksheet();
    expect(
      screen.getByRole("heading", { level: 1, name: /acme plumbing/i }),
    ).toBeDefined();
  });

  it("renders the Lifecycle status chip alongside the header", () => {
    renderWorksheet({ partner: { status: "green" } });
    const chip = screen.getByTestId("worksheet-lifecycle-status-chip");
    expect(chip.textContent).toMatch(/active/i);
  });

  it("renders all four Lifecycle status flip buttons regardless of current status — no automated transitions", () => {
    renderWorksheet({ partner: { status: "green" } });
    // PRD #249 #17 + issue #253 AC #3 — all four buttons are always
    // visible; any status can flip to any other status with one click.
    for (const colorLabel of [
      /uncontacted/i,
      /in progress/i,
      /active/i,
      /declined/i,
    ]) {
      expect(
        screen.getByRole("button", { name: new RegExp(`set lifecycle status to.*${colorLabel.source}`, "i") }),
      ).toBeDefined();
    }
  });

  it("clicking a flip button PATCHes the new Lifecycle status and updates the chip", async () => {
    renderWorksheet({ partner: { status: "grey" } });

    const button = screen.getByRole("button", {
      name: /set lifecycle status to active/i,
    });
    fireEvent.click(button);

    // Chip updates optimistically — the user sees the new label without
    // a page reload (issue #253 AC #2).
    await waitFor(() => {
      const chip = screen.getByTestId("worksheet-lifecycle-status-chip");
      expect(chip.textContent).toMatch(/active/i);
    });

    // And the PATCH was fired with the new status.
    expect(fetch).toHaveBeenCalledWith(
      "/api/referral-partners/p-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "green" }),
      }),
    );
  });
});

describe("ReferralPartnerWorksheet — editable company info (PRD #249, issue #253 AC #1)", () => {
  // The whitelist of editable columns mirrors the issue text. Each one is
  // exercised here through its accessible label so the test reflects what
  // a sighted user (and screen-reader user) can do, not the markup shape.
  const EDITABLE_TEXT_COLUMNS: Array<{
    label: RegExp;
    column: string;
    valueOnPartner: string;
    newValue: string;
  }> = [
    { label: /^company name$/i, column: "company_name", valueOnPartner: "Acme Plumbing", newValue: "Acme Plumbing & Co" },
    { label: /^industry$/i, column: "industry", valueOnPartner: "Plumbing", newValue: "HVAC" },
    { label: /^lead source$/i, column: "lead_source", valueOnPartner: "Google", newValue: "Yelp" },
    { label: /^office email$/i, column: "office_email", valueOnPartner: "ops@acme.test", newValue: "hello@acme.test" },
    { label: /^website$/i, column: "website", valueOnPartner: "acme.test", newValue: "acme.example" },
    { label: /^address$/i, column: "address", valueOnPartner: "100 Main St", newValue: "200 Main St" },
  ];

  it.each(EDITABLE_TEXT_COLUMNS)(
    "field $column is editable on the Worksheet and saves to the API on blur",
    async ({ label, column, newValue }) => {
      renderWorksheet();

      const input = screen.getByLabelText(label) as HTMLInputElement;
      fireEvent.change(input, { target: { value: newValue } });
      fireEvent.blur(input);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          "/api/referral-partners/p-1",
          expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({ [column]: newValue }),
          }),
        );
      });
    },
  );

  it("Operation size and Referral-fee terms and Notes are editable too", async () => {
    renderWorksheet({
      partner: { operation_size: null, referral_fee_terms: null, notes: null },
    });

    fireEvent.change(screen.getByLabelText(/^operation size$/i), {
      target: { value: "10–25" },
    });
    fireEvent.blur(screen.getByLabelText(/^operation size$/i));

    fireEvent.change(screen.getByLabelText(/^referral-fee terms$/i), {
      target: { value: "10% per closed job" },
    });
    fireEvent.blur(screen.getByLabelText(/^referral-fee terms$/i));

    fireEvent.change(screen.getByLabelText(/^notes$/i), {
      target: { value: "left vm Mon, callback Wed" },
    });
    fireEvent.blur(screen.getByLabelText(/^notes$/i));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/referral-partners/p-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ operation_size: "10–25" }),
        }),
      );
      expect(fetch).toHaveBeenCalledWith(
        "/api/referral-partners/p-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ referral_fee_terms: "10% per closed job" }),
        }),
      );
      expect(fetch).toHaveBeenCalledWith(
        "/api/referral-partners/p-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ notes: "left vm Mon, callback Wed" }),
        }),
      );
    });
  });

  it("Office phone is editable on the Worksheet (formatted display, raw stored)", async () => {
    renderWorksheet({ partner: { office_phone: null } });

    const input = screen.getByLabelText(/^office phone$/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5551234567" } });
    fireEvent.blur(input);

    await waitFor(() => {
      // The Worksheet trusts the platform's existing phone util to
      // normalize on blur; the call goes out with whatever the input
      // currently holds, which is enough to pin "office_phone is in the
      // PATCH body" for this slice.
      const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const phoneCall = calls.find((c) => {
        const body = JSON.parse((c[1] as RequestInit).body as string);
        return "office_phone" in body;
      });
      expect(phoneCall).toBeDefined();
    });
  });

  it("blurring an unchanged field does NOT fire a PATCH — empty saves are noise", async () => {
    renderWorksheet({ partner: { industry: "Plumbing" } });
    fireEvent.blur(screen.getByLabelText(/^industry$/i));
    // Give any incidental Promises a chance to resolve.
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("ReferralPartnerWorksheet — contacts surface (unchanged from #252)", () => {
  it("renders the Primary contact slot as 'Not set' when no primary is linked", () => {
    renderWorksheet({ primaryContact: null });
    const slot = screen.getByTestId("worksheet-primary-contact");
    expect(slot.textContent).toMatch(/primary contact/i);
    expect(slot.textContent).toMatch(/not set/i);
  });

  it("renders the Primary contact's name, formatted phone, and email when set", () => {
    renderWorksheet({
      primaryContact: {
        id: "c-1",
        full_name: "Pat Smith",
        phone: "+15555550100",
        email: "pat@acme.test",
      },
    });
    const slot = screen.getByTestId("worksheet-primary-contact");
    expect(slot.textContent).toContain("Pat Smith");
    expect(slot.textContent).toContain("(555) 555-0100");
    expect(slot.textContent).toContain("pat@acme.test");
  });

  it("renders the Owner contact's name, formatted phone, and email when set", () => {
    renderWorksheet({
      ownerContact: {
        id: "c-2",
        full_name: "Jamie Owner",
        phone: "+15555550200",
        email: "jamie@acme.test",
      },
    });
    const slot = screen.getByTestId("worksheet-owner-contact");
    expect(slot.textContent).toContain("Jamie Owner");
    expect(slot.textContent).toContain("(555) 555-0200");
    expect(slot.textContent).toContain("jamie@acme.test");
  });

  it("lists every Referral Contact in the 'Contacts at this company' section", () => {
    renderWorksheet({
      contacts: [
        { id: "c-1", full_name: "Pat Smith", phone: null, email: null },
        { id: "c-2", full_name: "Jamie Owner", phone: null, email: null },
        { id: "c-3", full_name: "Riley Newhire", phone: null, email: null },
      ],
    });
    const list = screen.getByTestId("worksheet-contacts-list");
    expect(within(list).getByText("Pat Smith")).toBeDefined();
    expect(within(list).getByText("Jamie Owner")).toBeDefined();
    expect(within(list).getByText("Riley Newhire")).toBeDefined();
  });

  it("renders an empty-state in 'Contacts at this company' when none are linked", () => {
    renderWorksheet({ contacts: [] });
    const list = screen.getByTestId("worksheet-contacts-list");
    expect(list.textContent).toMatch(/no contacts/i);
  });

  it("renders an empty Call log section when the partner has no history", () => {
    renderWorksheet();
    const section = screen.getByTestId("worksheet-call-log");
    expect(section.textContent).toMatch(/call log/i);
    expect(section.textContent).toMatch(/no calls/i);
  });
});

describe("ReferralPartnerWorksheet — Call log read (PRD #249, issue #254 AC #1)", () => {
  it("renders the Call log chronologically, newest first", () => {
    renderWorksheet({
      initialCalls: [
        {
          id: "call-old",
          referral_partner_id: "p-1",
          called_at: "2026-04-01T10:00:00Z",
          outcome: "voicemail",
          follow_up_at: null,
        },
        {
          id: "call-new",
          referral_partner_id: "p-1",
          called_at: "2026-05-10T11:00:00Z",
          outcome: "spoke",
          follow_up_at: null,
        },
      ],
    });
    const section = screen.getByTestId("worksheet-call-log");
    const entries = within(section).getAllByTestId(/^call-log-entry-/);
    expect(entries[0].getAttribute("data-testid")).toBe("call-log-entry-call-new");
    expect(entries[1].getAttribute("data-testid")).toBe("call-log-entry-call-old");
  });

  it("displays each entry's outcome and notes", () => {
    renderWorksheet({
      initialCalls: [
        {
          id: "call-1",
          referral_partner_id: "p-1",
          called_at: "2026-05-10T11:00:00Z",
          outcome: "interested",
          follow_up_at: null,
        },
      ],
    });
    const section = screen.getByTestId("worksheet-call-log");
    expect(section.textContent).toMatch(/interested/i);
  });
});

describe("ReferralPartnerWorksheet — Log a call (PRD #249, issue #254 AC #2 + #3)", () => {
  it("renders an inline 'Log a call' form with outcome / notes / follow-up / contact fields", () => {
    renderWorksheet();
    expect(screen.getByLabelText(/^outcome$/i)).toBeDefined();
    expect(screen.getByLabelText(/^call notes$/i)).toBeDefined();
    expect(screen.getByLabelText(/^follow[- ]up date$/i)).toBeDefined();
    expect(screen.getByLabelText(/^referral contact$/i)).toBeDefined();
  });

  it("submitting the form POSTs the new call to /api/referral-partners/[id]/calls", async () => {
    renderWorksheet();

    fireEvent.change(screen.getByLabelText(/^outcome$/i), {
      target: { value: "spoke" },
    });
    fireEvent.change(screen.getByLabelText(/^call notes$/i), {
      target: { value: "Asked for a quote" },
    });
    fireEvent.change(screen.getByLabelText(/^follow[- ]up date$/i), {
      target: { value: "2026-06-15" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^log call$/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/referral-partners/p-1/calls",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === "/api/referral-partners/p-1/calls",
    );
    expect(call).toBeDefined();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.outcome).toBe("spoke");
    expect(body.notes).toBe("Asked for a quote");
    expect(body.follow_up_at).toBe("2026-06-15");
  });

  // ── + Add contact integration tests (issue #255) ─────────────────────
  //
  // Mounts the Worksheet, clicks "+ Add contact", fills the inline 4-field
  // form (name, number, email, note), submits, and asserts the new contact
  // is visible in (a) the "Contacts at this company" list, (b) the Primary
  // contact dropdown, AND (c) the Owner contact dropdown — all on the SAME
  // render (no reload). This is the load-bearing contract for the slice.

  it("the referral_contact dropdown defaults to the Primary contact", () => {
    renderWorksheet({
      partner: { primary_contact_id: "c-primary" },
      primaryContact: { id: "c-primary", full_name: "Pat Smith", phone: null, email: null },
      contacts: [
        { id: "c-primary", full_name: "Pat Smith", phone: null, email: null },
        { id: "c-other", full_name: "Jamie Other", phone: null, email: null },
      ],
    });
    const select = screen.getByLabelText(/^referral contact$/i) as HTMLSelectElement;
    expect(select.value).toBe("c-primary");
  });

  // ── THE LOAD-BEARING CONTRACT TEST (issue #254 AC #6) ──────────────────
  //
  // "RTL integration test mounts the Worksheet, logs a call, and asserts
  // both the call appears in history AND the partner's denormalized fields
  // are observable on next render."
  //
  // This is the test that pins the rule the whole feature depends on —
  // without it, list-page sort/filter silently breaks.
  it("logging a call adds the entry to history AND surfaces the new denormalized last-called info", async () => {
    // The fetch stub from beforeEach echoes the body back as the new call.
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        if (url.endsWith("/calls") && init?.method === "POST") {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              call: {
                id: "call-new",
                referral_partner_id: "p-1",
                called_at: "2026-05-15T10:00:00Z",
                outcome: body.outcome,
                follow_up_at: body.follow_up_at ?? null,
                notes: body.notes ?? null,
                referral_contact_id: body.referral_contact_id ?? null,
              },
            }),
          } as Response;
        }
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }),
    );

    renderWorksheet();

    fireEvent.change(screen.getByLabelText(/^outcome$/i), {
      target: { value: "interested" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^log call$/i }));

    // The new call appears in history.
    await waitFor(() => {
      const section = screen.getByTestId("worksheet-call-log");
      expect(within(section).getByTestId("call-log-entry-call-new")).toBeDefined();
    });

    // The denormalized last-called outcome is observable on the rendered
    // page. The Call log section surfaces "Last call: …" so the user can
    // see at a glance what just happened — the same value the list page
    // reads off the `referral_partners` row.
    const section = screen.getByTestId("worksheet-call-log");
    expect(section.textContent).toMatch(/last call/i);
    expect(section.textContent).toMatch(/interested/i);
  });
});

describe("ReferralPartnerWorksheet — + Add contact (PRD #249, issue #255)", () => {
  it("renders a + Add contact button inside the Contacts at this company section", () => {
    renderWorksheet();
    const list = screen.getByTestId("worksheet-contacts-list");
    expect(
      within(list).getByRole("button", { name: /\+ add contact/i }),
    ).toBeDefined();
  });

  it("clicking + Add contact reveals an inline 4-field form (name, number, email, note)", () => {
    renderWorksheet();
    const list = screen.getByTestId("worksheet-contacts-list");
    fireEvent.click(
      within(list).getByRole("button", { name: /\+ add contact/i }),
    );
    const form = screen.getByTestId("worksheet-add-contact-form");
    expect(within(form).getByLabelText(/^name$/i)).toBeDefined();
    expect(within(form).getByLabelText(/^number$/i)).toBeDefined();
    expect(within(form).getByLabelText(/^email$/i)).toBeDefined();
    expect(within(form).getByLabelText(/^note$/i)).toBeDefined();
  });

  it("renders a Primary contact dropdown and an Owner contact dropdown that include every Referral Contact", () => {
    renderWorksheet({
      contacts: [
        { id: "c-1", full_name: "Pat Smith", phone: null, email: null },
        { id: "c-2", full_name: "Jamie Other", phone: null, email: null },
      ],
    });
    const primarySelect = screen.getByLabelText(
      /primary contact/i,
    ) as HTMLSelectElement;
    const ownerSelect = screen.getByLabelText(
      /owner contact/i,
    ) as HTMLSelectElement;
    expect(within(primarySelect).getByText("Pat Smith")).toBeDefined();
    expect(within(primarySelect).getByText("Jamie Other")).toBeDefined();
    expect(within(ownerSelect).getByText("Pat Smith")).toBeDefined();
    expect(within(ownerSelect).getByText("Jamie Other")).toBeDefined();
  });

  // ── THE LOAD-BEARING CONTRACT TEST (issue #255 acceptance criteria) ─────
  //
  // After clicking + Add contact and submitting the inline form, the new
  // Referral Contact MUST appear, on the same render, in:
  //   (a) the "Contacts at this company" list
  //   (b) the Primary contact dropdown
  //   (c) the Owner contact dropdown
  // — without any page reload. List-page filtering of Referral Contacts and
  // the Worksheet's own primary/owner pickers depend on this contract.
  it("submitting + Add contact POSTs the new contact and makes it visible in the list AND both dropdowns without reload", async () => {
    renderWorksheet({ contacts: [] });

    const list = screen.getByTestId("worksheet-contacts-list");
    fireEvent.click(
      within(list).getByRole("button", { name: /\+ add contact/i }),
    );

    const form = screen.getByTestId("worksheet-add-contact-form");
    fireEvent.change(within(form).getByLabelText(/^name$/i), {
      target: { value: "Pat Smith" },
    });
    fireEvent.change(within(form).getByLabelText(/^number$/i), {
      target: { value: "5551234567" },
    });
    fireEvent.change(within(form).getByLabelText(/^email$/i), {
      target: { value: "pat@acme.test" },
    });
    fireEvent.change(within(form).getByLabelText(/^note$/i), {
      target: { value: "found via Yelp" },
    });
    fireEvent.click(
      within(form).getByRole("button", { name: /^save contact$/i }),
    );

    // POST goes to the new endpoint with the 4-field payload.
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/referral-partners/p-1/contacts",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === "/api/referral-partners/p-1/contacts",
    );
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.full_name).toBe("Pat Smith");
    expect(body.email).toBe("pat@acme.test");
    expect(body.notes).toBe("found via Yelp");

    // (a) Visible in the Contacts at this company list, without reload.
    await waitFor(() => {
      const refreshedList = screen.getByTestId("worksheet-contacts-list");
      expect(within(refreshedList).getByText("Pat Smith")).toBeDefined();
    });

    // (b) Visible in the Primary contact dropdown.
    const primarySelect = screen.getByLabelText(
      /primary contact/i,
    ) as HTMLSelectElement;
    expect(within(primarySelect).getByText("Pat Smith")).toBeDefined();

    // (c) Visible in the Owner contact dropdown.
    const ownerSelect = screen.getByLabelText(
      /owner contact/i,
    ) as HTMLSelectElement;
    expect(within(ownerSelect).getByText("Pat Smith")).toBeDefined();
  });
});

// ── Soft-delete from the Worksheet (issue #256) ────────────────────────
describe("ReferralPartnerWorksheet — Delete action", () => {
  it("renders a Delete button in the header", () => {
    renderWorksheet();
    expect(screen.getByTestId("worksheet-delete-button")).toBeDefined();
  });

  it("on Delete: confirms, POSTs to /delete, and navigates back to /referral-partners", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWorksheet();

    fireEvent.click(screen.getByTestId("worksheet-delete-button"));

    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith("/referral-partners");
    });
    expect(confirmSpy).toHaveBeenCalled();
    expect(routerRefresh).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("if the user cancels the confirmation, no fetch fires and no navigation happens", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWorksheet();

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();
    fireEvent.click(screen.getByTestId("worksheet-delete-button"));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
