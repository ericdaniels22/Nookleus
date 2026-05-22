import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import type { Contact } from "@/lib/types";

// The picker searches role='insurance' contacts as the user types. A
// mutable module-level result lets each test seed its own match list.
let contactsResult: { data: unknown; error: unknown } = {
  data: [],
  error: null,
};
// The inline-create flow inserts a contact and reads the new row back.
// `insertResult` seeds that row; `lastInsert` captures the payload sent.
let insertResult: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};
let lastInsert: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: () => Promise.resolve("org-test"),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    // The contacts search is a chainable query whose builder methods
    // return the builder; awaiting it resolves to the seeded result.
    // `.insert(payload).select().single()` is a separate chain that
    // records the payload and resolves to the seeded inserted row.
    from: () => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "or", "limit"]) {
        builder[method] = () => builder;
      }
      builder.then = (resolve: (r: unknown) => void) => resolve(contactsResult);
      builder.insert = (payload: Record<string, unknown>) => {
        lastInsert = payload;
        return {
          select: () => ({ single: () => Promise.resolve(insertResult) }),
        };
      };
      return builder;
    },
  }),
}));

import InsuranceCompanyPicker from "./insurance-company-picker";

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
    created_at: "2026-05-20T00:00:00Z",
    updated_at: "2026-05-20T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  contactsResult = { data: [], error: null };
  insertResult = { data: null, error: null };
  lastInsert = null;
});

describe("InsuranceCompanyPicker — search (#193)", () => {
  it("renders a matching insurance company as the user types", async () => {
    contactsResult = {
      data: [makeContact({ id: "c-1", full_name: "State Farm" })],
      error: null,
    };

    render(<InsuranceCompanyPicker value={null} onChange={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/search insurance/i), {
      target: { value: "state" },
    });

    expect(
      await screen.findByRole("button", { name: /State Farm/i }),
    ).toBeDefined();
  });
});

describe("InsuranceCompanyPicker — claims email (#193)", () => {
  it("shows each matching company's claims email alongside its name", async () => {
    contactsResult = {
      data: [
        makeContact({
          id: "c-1",
          full_name: "Allstate",
          email: "claims@allstate.com",
        }),
      ],
      error: null,
    };

    render(<InsuranceCompanyPicker value={null} onChange={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/search insurance/i), {
      target: { value: "all" },
    });

    expect(await screen.findByText("Allstate")).toBeDefined();
    expect(screen.getByText("claims@allstate.com")).toBeDefined();
  });
});

describe("InsuranceCompanyPicker — selecting (#193)", () => {
  it("fires onChange with the chosen company when a match is selected", async () => {
    const chosen = makeContact({ id: "c-9", full_name: "Liberty Mutual" });
    contactsResult = { data: [chosen], error: null };
    const onChange = vi.fn();

    render(<InsuranceCompanyPicker value={null} onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText(/search insurance/i), {
      target: { value: "liberty" },
    });

    fireEvent.click(
      await screen.findByRole("button", { name: /Liberty Mutual/i }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(chosen);
  });
});

describe("InsuranceCompanyPicker — no matches (#193)", () => {
  it("tells the user when a search turns up no insurance companies", async () => {
    contactsResult = { data: [], error: null };

    render(<InsuranceCompanyPicker value={null} onChange={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/search insurance/i), {
      target: { value: "nonesuch" },
    });

    expect(await screen.findByText(/no matching insurance/i)).toBeDefined();
  });
});

describe("InsuranceCompanyPicker — linked company (#193)", () => {
  it("shows the company already linked to the job", () => {
    render(
      <InsuranceCompanyPicker
        value={makeContact({ id: "c-1", full_name: "Travelers" })}
        onChange={() => {}}
      />,
    );

    expect(screen.getByText("Travelers")).toBeDefined();
  });
});

describe("InsuranceCompanyPicker — clearing (#193)", () => {
  it("fires onChange with null when the linked company is cleared", () => {
    const onChange = vi.fn();
    render(
      <InsuranceCompanyPicker
        value={makeContact({ id: "c-1", full_name: "Travelers" })}
        onChange={onChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /clear insurance company/i }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBeNull();
  });
});

describe("InsuranceCompanyPicker — create affordance (#194)", () => {
  it("offers '+ New insurance company' when no existing company matches the typed name", async () => {
    contactsResult = { data: [], error: null };

    render(<InsuranceCompanyPicker value={null} onChange={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/search insurance/i), {
      target: { value: "Geico" },
    });

    expect(
      await screen.findByRole("button", { name: /new insurance company/i }),
    ).toBeDefined();
  });

  it("withholds '+ New' when a company with that exact name already exists", async () => {
    contactsResult = {
      data: [makeContact({ id: "c-1", full_name: "State Farm" })],
      error: null,
    };

    render(<InsuranceCompanyPicker value={null} onChange={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/search insurance/i), {
      target: { value: "state farm" },
    });

    // Wait for the search to settle on the exact match...
    await screen.findByRole("button", { name: /^State Farm/i });
    // ...then the create affordance must be gone.
    expect(
      screen.queryByRole("button", { name: /new insurance company/i }),
    ).toBeNull();
  });
});

describe("InsuranceCompanyPicker — inline create form (#194)", () => {
  it("inline-expands a prefilled name + claims-email form, never a modal", async () => {
    contactsResult = { data: [], error: null };

    render(<InsuranceCompanyPicker value={null} onChange={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/search insurance/i), {
      target: { value: "Geico" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /new insurance company/i }),
    );

    // Company-name field is prefilled with the typed text.
    const nameField = screen.getByLabelText(
      /company name/i,
    ) as HTMLInputElement;
    expect(nameField.value).toBe("Geico");
    // An optional claims-email field is present.
    expect(screen.getByLabelText(/claims email/i)).toBeDefined();
    // The form is inline — it never opens a modal dialog.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("creates a role='insurance' contact and auto-selects it on submit", async () => {
    contactsResult = { data: [], error: null };
    const created = makeContact({
      id: "c-new",
      full_name: "Geico",
      email: "claims@geico.com",
    });
    insertResult = { data: created, error: null };
    const onChange = vi.fn();

    render(<InsuranceCompanyPicker value={null} onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText(/search insurance/i), {
      target: { value: "Geico" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /new insurance company/i }),
    );
    fireEvent.change(screen.getByLabelText(/claims email/i), {
      target: { value: "claims@geico.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create company/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0]).toEqual(created);
    expect(lastInsert).toMatchObject({
      full_name: "Geico",
      email: "claims@geico.com",
      role: "insurance",
      organization_id: "org-test",
    });
  });

  it("rejects a malformed claims email with a message and does not insert", async () => {
    contactsResult = { data: [], error: null };
    const onChange = vi.fn();

    render(<InsuranceCompanyPicker value={null} onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText(/search insurance/i), {
      target: { value: "Geico" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /new insurance company/i }),
    );
    fireEvent.change(screen.getByLabelText(/claims email/i), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create company/i }));

    expect(await screen.findByText(/valid claims email/i)).toBeDefined();
    expect(lastInsert).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("creates the company with no email when the claims email is left blank", async () => {
    contactsResult = { data: [], error: null };
    const created = makeContact({ id: "c-new", full_name: "Geico", email: null });
    insertResult = { data: created, error: null };
    const onChange = vi.fn();

    render(<InsuranceCompanyPicker value={null} onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText(/search insurance/i), {
      target: { value: "Geico" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /new insurance company/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /create company/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(lastInsert).toMatchObject({ full_name: "Geico", email: null });
  });
});
