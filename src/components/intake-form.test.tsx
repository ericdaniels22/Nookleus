import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";

import type { Contact, FormConfig } from "@/lib/types";

// ─── Mutable mock state, seeded per test (mirrors insurance-company-picker.test.tsx) ───

// The form config served by GET /api/settings/intake-form.
let formConfigFixture: FormConfig = { sections: [] };
// The role='insurance' rows the embedded picker's search resolves to.
let contactsSearchResult: { data: unknown; error: unknown } = {
  data: [],
  error: null,
};
// Per-table select fixtures. The intake form fetches referral_partners when
// the config carries a `job.referral_partner_id`-mapped field (slice D, #302);
// every other awaited select still resolves through contactsSearchResult so
// the existing insurance-picker tests keep working unchanged.
let selectResults: Record<string, { data: unknown; error: unknown }> = {};
// Insert payloads captured per table, plus the row each insert reads back.
let inserts: Record<string, Record<string, unknown>[]> = {};
let insertResults: Record<string, { data: unknown; error: unknown }> = {};
const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

// The org's damage_types rows (name/label/colors), seeded per test for the
// §2.6 tint-treatment specs (#915).
let damageTypesFixture: {
  name: string;
  display_label: string;
  bg_color: string;
  text_color: string;
}[] = [];

vi.mock("@/lib/config-context", () => ({
  useConfig: () => ({ damageTypes: damageTypesFixture }),
}));

vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: () => Promise.resolve("org-test"),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "or", "is", "limit", "order"]) {
        builder[method] = () => builder;
      }
      // Awaiting the builder resolves a select. Per-table fixtures take
      // precedence (referral_partners for slice D, #302); otherwise we fall
      // back to the contacts-picker fixture so insurance-picker tests keep
      // working unchanged.
      builder.then = (resolve: (r: unknown) => void) =>
        resolve(selectResults[table] ?? contactsSearchResult);
      // `.insert(payload)` records the payload and supports both a
      // `.select().single()` read-back (contacts, jobs) and a bare await
      // (job_custom_fields, job_activities).
      builder.insert = (payload: Record<string, unknown>) => {
        (inserts[table] ??= []).push(payload);
        const result = insertResults[table] ?? {
          data: { id: `${table}-id` },
          error: null,
        };
        return {
          select: () => ({ single: () => Promise.resolve(result) }),
          then: (resolve: (r: unknown) => void) => resolve({ error: null }),
        };
      };
      return builder;
    },
  }),
}));

import IntakeForm from "./intake-form";

// ─── Fixtures ───

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "c-1",
    organization_id: "org-1",
    full_name: "State Farm",
    phone: null,
    email: "claims@statefarm.com",
    role: "insurance",
    company: null,
    title: null,
    notes: null,
    created_at: "2026-05-21T00:00:00Z",
    updated_at: "2026-05-21T00:00:00Z",
    ...overrides,
  };
}

// A form config carrying the referrer field on top of the three fields
// the submit hard-requires. The toggle in Settings → Intake Form maps to
// the presence (or visibility) of this field in the config; slice D
// (#302) adds the special render + write path for it.
function makeConfigWithReferrer(): FormConfig {
  return {
    sections: [
      {
        id: "s1",
        title: "Job",
        fields: [
          {
            id: "f-name",
            type: "text",
            label: "Full Name",
            placeholder: "name-input",
            maps_to: "contact.full_name",
          },
          {
            id: "f-damage",
            type: "text",
            label: "Damage Type",
            placeholder: "damage-input",
            maps_to: "job.damage_type",
          },
          {
            id: "f-addr",
            type: "text",
            label: "Property Address",
            placeholder: "address-input",
            maps_to: "job.property_address",
          },
          {
            id: "referrer",
            type: "text",
            label: "Referred by",
            maps_to: "job.referral_partner_id",
            is_default: true,
          },
        ],
      },
    ],
  };
}

// A form config carrying the four fields the intake submit path cares
// about: the three fields the submit hard-requires plus the insurance
// field mapped to job.insurance_company. Each field has a unique
// placeholder so the test can target its plain input directly.
function makeConfig(opts: { insuranceRequired?: boolean } = {}): FormConfig {
  return {
    sections: [
      {
        id: "s1",
        title: "Job",
        fields: [
          {
            id: "f-name",
            type: "text",
            label: "Full Name",
            placeholder: "name-input",
            maps_to: "contact.full_name",
          },
          {
            id: "f-damage",
            type: "text",
            label: "Damage Type",
            placeholder: "damage-input",
            maps_to: "job.damage_type",
          },
          {
            id: "f-addr",
            type: "text",
            label: "Property Address",
            placeholder: "address-input",
            maps_to: "job.property_address",
          },
          {
            id: "f-ins",
            type: "text",
            label: "Insurance Company",
            placeholder: "ins-input",
            maps_to: "job.insurance_company",
            required: opts.insuranceRequired,
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  formConfigFixture = makeConfig();
  damageTypesFixture = [];
  contactsSearchResult = { data: [], error: null };
  selectResults = {};
  inserts = {};
  insertResults = {
    contacts: { data: { id: "contact-1" }, error: null },
    jobs: { data: { id: "job-1", job_number: "J-100" }, error: null },
  };
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ config: formConfigFixture }),
    }),
  ) as unknown as typeof fetch;
});

// ─── Mobile-first layout (#915) ─────────────────────────────────────────────
// Related fields share a two-up row at iPad width (design-system §7.2); the
// pairing is planned by src/lib/intake-form-layout.ts from whatever config
// the org has. The form renders each planned row as a `data-slot="field-row"`
// group — paired fields land in the same group, full-width fields alone.

describe("IntakeForm — related compact fields share a row (#915)", () => {
  it("renders adjacent phone + email in one field-row and the address alone in its own", async () => {
    formConfigFixture = {
      sections: [
        {
          id: "s1",
          title: "Customer",
          fields: [
            {
              id: "f-name",
              type: "text",
              label: "Full Name",
              placeholder: "name-input",
              maps_to: "contact.full_name",
            },
            { id: "f-phone", type: "phone", label: "Phone", placeholder: "phone-input" },
            { id: "f-email", type: "email", label: "Email", placeholder: "email-input" },
            {
              id: "f-addr",
              type: "text",
              label: "Property Address",
              placeholder: "address-input",
              maps_to: "job.property_address",
            },
          ],
        },
      ],
    };

    render(<IntakeForm />);

    const phone = await screen.findByPlaceholderText("phone-input");
    const email = screen.getByPlaceholderText("email-input");
    const address = screen.getByPlaceholderText("address-input");

    const rowOf = (el: HTMLElement) => el.closest('[data-slot="field-row"]');
    expect(rowOf(phone)).not.toBeNull();
    expect(rowOf(phone)).toBe(rowOf(email));
    expect(rowOf(address)).not.toBe(rowOf(phone));
  });
});

// ─── Loading / empty / error states (#915, design-system §5 + §8 DoD) ───────

describe("IntakeForm — loading state (#915)", () => {
  it("shows a skeleton while the form config is loading", () => {
    // A fetch that never settles keeps the form in its loading state.
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;

    render(<IntakeForm />);

    expect(screen.getByRole("status", { name: /loading/i })).toBeDefined();
  });
});

describe("IntakeForm — config fetch failure shows an error with retry (#915)", () => {
  it("renders an error state when the fetch fails, and retry loads the form", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error("network down")));

    render(<IntakeForm />);

    // The failure is surfaced as an error state — not the misleading
    // "no form configuration" empty state.
    fireEvent.click(await screen.findByRole("button", { name: /try again/i }));

    // The retry re-fetches (mock now resolves the config) and the form renders.
    expect(await screen.findByPlaceholderText("name-input")).toBeDefined();
  });
});

// ─── Damage-type tint treatment (#915, design-system §2.6) ──────────────────
// The Damage type selector is where the badge vocabulary is chosen, so the
// selected pill renders the softened tint — a ~14%-alpha wash of the org's
// stored bg color behind an AA-legible text tone — never a solid fill of the
// raw stored colors.

describe("IntakeForm — damage-type pill renders the §2.6 tint, not a solid fill (#915)", () => {
  it("gives the selected damage-type pill a softened 14%-alpha background and legible text", async () => {
    damageTypesFixture = [
      { name: "water", display_label: "Water", bg_color: "#38BDF8", text_color: "#7DD3FC" },
      { name: "fire", display_label: "Fire", bg_color: "#FB923C", text_color: "#FDBA74" },
    ];
    formConfigFixture = {
      sections: [
        {
          id: "s1",
          title: "Job",
          fields: [
            {
              id: "f-damage",
              type: "pill",
              label: "Damage Type",
              maps_to: "job.damage_type",
              options_source: "damage_types",
            },
          ],
        },
      ],
    };

    render(<IntakeForm />);

    const water = await screen.findByRole("button", { name: "Water" });
    fireEvent.click(water);

    // Softened per §2.6: the stored bg becomes a 14%-alpha tint; the stored
    // text tone (already AA on the card surface) passes through unchanged.
    expect(water.style.backgroundColor).toBe("rgba(56, 189, 248, 0.14)");
    expect(water.style.color).toBe("rgb(125, 211, 252)");

    // Unselected pills stay neutral — no stored-color fill leaks through.
    const fire = screen.getByRole("button", { name: "Fire" });
    expect(fire.style.backgroundColor).toBe("");
  });
});

describe("IntakeForm — insurance-company picker swap (#195)", () => {
  it("renders the insurance-company picker for the job.insurance_company field instead of a plain input", async () => {
    render(<IntakeForm />);

    // The picker's search box stands in for the configured plain input.
    expect(
      await screen.findByPlaceholderText(/search insurance companies/i),
    ).toBeDefined();
    // The configured plain text input is not rendered for that field.
    expect(screen.queryByPlaceholderText("ins-input")).toBeNull();
  });
});

describe("IntakeForm — linking the picked company to the job (#195)", () => {
  it("writes insurance_contact_id and the company-name snapshot onto the submitted job", async () => {
    contactsSearchResult = {
      data: [makeContact({ id: "c-1", full_name: "State Farm" })],
      error: null,
    };

    render(<IntakeForm />);

    // Fill the three fields the intake submit path hard-requires.
    fireEvent.change(await screen.findByPlaceholderText("name-input"), {
      target: { value: "Jane Doe" },
    });
    fireEvent.change(screen.getByPlaceholderText("damage-input"), {
      target: { value: "Water" },
    });
    fireEvent.change(screen.getByPlaceholderText("address-input"), {
      target: { value: "12 Oak St" },
    });

    // Pick an insurance company through the embedded picker.
    fireEvent.change(
      screen.getByPlaceholderText(/search insurance companies/i),
      { target: { value: "State" } },
    );
    fireEvent.click(await screen.findByRole("button", { name: /State Farm/i }));

    fireEvent.click(screen.getByRole("button", { name: /create job/i }));

    await waitFor(() => expect(inserts.jobs).toBeDefined());
    expect(inserts.jobs[0]).toMatchObject({
      insurance_contact_id: "c-1",
      insurance_company: "State Farm",
    });
  });
});

describe("IntakeForm — insurance company is optional (#195)", () => {
  it("submits the job with null insurance fields when no company is picked", async () => {
    render(<IntakeForm />);

    fireEvent.change(await screen.findByPlaceholderText("name-input"), {
      target: { value: "Jane Doe" },
    });
    fireEvent.change(screen.getByPlaceholderText("damage-input"), {
      target: { value: "Water" },
    });
    fireEvent.change(screen.getByPlaceholderText("address-input"), {
      target: { value: "12 Oak St" },
    });

    // The picker is left untouched — no insurance company is chosen.
    fireEvent.click(screen.getByRole("button", { name: /create job/i }));

    await waitFor(() => expect(inserts.jobs).toBeDefined());
    expect(inserts.jobs[0]).toMatchObject({
      insurance_contact_id: null,
      insurance_company: null,
    });
  });
});

describe("IntakeForm — required insurance field (#195)", () => {
  it("blocks submit when the config marks the insurance field required and none is picked", async () => {
    formConfigFixture = makeConfig({ insuranceRequired: true });

    render(<IntakeForm />);

    // Every field the submit would otherwise complain about is filled —
    // only the now-required insurance field is left empty.
    fireEvent.change(await screen.findByPlaceholderText("name-input"), {
      target: { value: "Jane Doe" },
    });
    fireEvent.change(screen.getByPlaceholderText("damage-input"), {
      target: { value: "Water" },
    });
    fireEvent.change(screen.getByPlaceholderText("address-input"), {
      target: { value: "12 Oak St" },
    });

    fireEvent.click(screen.getByRole("button", { name: /create job/i }));

    // Submit is rejected for the insurance field — no job is written.
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/insurance company/i),
      ),
    );
    expect(inserts.jobs).toBeUndefined();
  });
});

describe("IntakeForm — typed search text is never persisted (#195)", () => {
  it("does not persist picker search text as a loose insurance_company value", async () => {
    render(<IntakeForm />);

    fireEvent.change(await screen.findByPlaceholderText("name-input"), {
      target: { value: "Jane Doe" },
    });
    fireEvent.change(screen.getByPlaceholderText("damage-input"), {
      target: { value: "Water" },
    });
    fireEvent.change(screen.getByPlaceholderText("address-input"), {
      target: { value: "12 Oak St" },
    });

    // Type a company name into the picker but never select or create it.
    fireEvent.change(
      screen.getByPlaceholderText(/search insurance companies/i),
      { target: { value: "Some Unlisted Insurer" } },
    );

    fireEvent.click(screen.getByRole("button", { name: /create job/i }));

    await waitFor(() => expect(inserts.jobs).toBeDefined());
    // The unbacked text is not carried onto the job in any form.
    expect(inserts.jobs[0]).toMatchObject({
      insurance_contact_id: null,
      insurance_company: null,
    });
  });
});

// ─── Referrer field (slice D, #302) ────────────────────────────────────────
// The Settings → Intake Form toggle enables a built-in `referrer` field
// (maps_to: "job.referral_partner_id"). When the field is in the config the
// intake form renders the shared `<ReferrerPicker>` and writes the picked
// partner's id to `jobs.referral_partner_id` directly — NOT to the generic
// `job_custom_fields` key/value table (acceptance criterion: FK column, not
// custom_fields).

describe("IntakeForm — referrer field renders ReferrerPicker (#302)", () => {
  it("renders the picker (with active partners) for a field mapped to job.referral_partner_id", async () => {
    formConfigFixture = makeConfigWithReferrer();
    selectResults = {
      referral_partners: {
        data: [
          {
            id: "rp-1",
            company_name: "Acme Plumbing",
            status: "green",
            deleted_at: null,
          },
        ],
        error: null,
      },
    };

    render(<IntakeForm />);

    // The active partner appears in the picker, proving ReferrerPicker
    // (not the configured text input) was rendered for the referrer field.
    expect(await screen.findByText("Acme Plumbing")).toBeDefined();
  });
});

describe("IntakeForm — referrer routed to jobs.referral_partner_id, not custom_fields (#302)", () => {
  it("writes the picked partner id to jobs.referral_partner_id and never to job_custom_fields", async () => {
    formConfigFixture = makeConfigWithReferrer();
    selectResults = {
      referral_partners: {
        data: [
          {
            id: "rp-1",
            company_name: "Acme Plumbing",
            status: "green",
            deleted_at: null,
          },
        ],
        error: null,
      },
    };

    render(<IntakeForm />);

    fireEvent.change(await screen.findByPlaceholderText("name-input"), {
      target: { value: "Jane Doe" },
    });
    fireEvent.change(screen.getByPlaceholderText("damage-input"), {
      target: { value: "Water" },
    });
    fireEvent.change(screen.getByPlaceholderText("address-input"), {
      target: { value: "12 Oak St" },
    });

    fireEvent.click(await screen.findByRole("button", { name: /Acme Plumbing/i }));

    fireEvent.click(screen.getByRole("button", { name: /create job/i }));

    await waitFor(() => expect(inserts.jobs).toBeDefined());
    expect(inserts.jobs[0]).toMatchObject({ referral_partner_id: "rp-1" });
    // The FK lives on jobs; the referrer must NOT be persisted as a generic
    // key/value pair on job_custom_fields.
    expect(inserts.job_custom_fields).toBeUndefined();
  });
});

describe("IntakeForm — referrer left blank (#302)", () => {
  it("writes referral_partner_id: null when the picker is not used", async () => {
    formConfigFixture = makeConfigWithReferrer();
    selectResults = {
      referral_partners: {
        data: [
          {
            id: "rp-1",
            company_name: "Acme Plumbing",
            status: "green",
            deleted_at: null,
          },
        ],
        error: null,
      },
    };

    render(<IntakeForm />);

    fireEvent.change(await screen.findByPlaceholderText("name-input"), {
      target: { value: "Jane Doe" },
    });
    fireEvent.change(screen.getByPlaceholderText("damage-input"), {
      target: { value: "Water" },
    });
    fireEvent.change(screen.getByPlaceholderText("address-input"), {
      target: { value: "12 Oak St" },
    });

    fireEvent.click(screen.getByRole("button", { name: /create job/i }));

    await waitFor(() => expect(inserts.jobs).toBeDefined());
    expect(inserts.jobs[0]).toMatchObject({ referral_partner_id: null });
  });
});

// ─── New-intake notifications (#669) ────────────────────────────────────────
// After a Job is created, the form fires a best-effort POST to
// /api/intake/notify so the rest of the Organization gets an in-app bell. The
// call must never block or break Intake submission (the Job is already saved).
// See docs/adr/0018-new-intake-push-notifications.md.

function notifyCalls() {
  const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
  return fetchMock.mock.calls.filter(([url]) => url === "/api/intake/notify");
}

describe("IntakeForm — fires new-intake notifications after submit (#669)", () => {
  it("POSTs the new Job's id to /api/intake/notify on a successful submit", async () => {
    render(<IntakeForm />);

    fireEvent.change(await screen.findByPlaceholderText("name-input"), {
      target: { value: "Jane Doe" },
    });
    fireEvent.change(screen.getByPlaceholderText("damage-input"), {
      target: { value: "Water" },
    });
    fireEvent.change(screen.getByPlaceholderText("address-input"), {
      target: { value: "12 Oak St" },
    });

    fireEvent.click(screen.getByRole("button", { name: /create job/i }));

    await waitFor(() => expect(notifyCalls()).toHaveLength(1));
    const [, init] = notifyCalls()[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ jobId: "job-1" });
  });

  it("still navigates and shows success when the notify call fails (best-effort)", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/intake/notify") return Promise.reject(new Error("network down"));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ config: formConfigFixture }),
      });
    });

    render(<IntakeForm />);

    fireEvent.change(await screen.findByPlaceholderText("name-input"), {
      target: { value: "Jane Doe" },
    });
    fireEvent.change(screen.getByPlaceholderText("damage-input"), {
      target: { value: "Water" },
    });
    fireEvent.change(screen.getByPlaceholderText("address-input"), {
      target: { value: "12 Oak St" },
    });

    fireEvent.click(screen.getByRole("button", { name: /create job/i }));

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/jobs/job-1"));
    // §6 voice: confirmations are past tense — no "successfully", no exclamation.
    expect(toast.success).toHaveBeenCalledWith("Job J-100 created");
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("IntakeForm — toggle off: referrer field absent (#302)", () => {
  it("does not render the picker and submits exactly as today when the field is omitted from the config", async () => {
    // Default `makeConfig()` is the today-shape (no referrer field).
    render(<IntakeForm />);

    // Picker is not in the DOM.
    expect(screen.queryByText(/promote and attach/i)).toBeNull();

    fireEvent.change(await screen.findByPlaceholderText("name-input"), {
      target: { value: "Jane Doe" },
    });
    fireEvent.change(screen.getByPlaceholderText("damage-input"), {
      target: { value: "Water" },
    });
    fireEvent.change(screen.getByPlaceholderText("address-input"), {
      target: { value: "12 Oak St" },
    });

    fireEvent.click(screen.getByRole("button", { name: /create job/i }));

    await waitFor(() => expect(inserts.jobs).toBeDefined());
    // The FK is absent from the insert payload (today's behavior preserved).
    expect("referral_partner_id" in inserts.jobs[0]).toBe(false);
  });
});
