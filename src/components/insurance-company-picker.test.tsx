import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { Contact } from "@/lib/types";

// The picker searches role='insurance' contacts as the user types. A
// mutable module-level result lets each test seed its own match list.
let contactsResult: { data: unknown; error: unknown } = {
  data: [],
  error: null,
};

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    // The contacts search is a chainable query whose builder methods
    // return the builder; awaiting it resolves to the seeded result.
    from: () => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "or", "limit"]) {
        builder[method] = () => builder;
      }
      builder.then = (resolve: (r: unknown) => void) => resolve(contactsResult);
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
