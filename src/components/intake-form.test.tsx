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
// Insert payloads captured per table, plus the row each insert reads back.
let inserts: Record<string, Record<string, unknown>[]> = {};
let insertResults: Record<string, { data: unknown; error: unknown }> = {};
const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("@/lib/config-context", () => ({
  useConfig: () => ({ damageTypes: [] }),
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
      for (const method of ["select", "eq", "or", "limit", "order"]) {
        builder[method] = () => builder;
      }
      // Awaiting the builder resolves the embedded picker's contacts search.
      builder.then = (resolve: (r: unknown) => void) =>
        resolve(contactsSearchResult);
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
  contactsSearchResult = { data: [], error: null };
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
