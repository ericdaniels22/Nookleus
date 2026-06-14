import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import ContactPicker from "./contact-picker";

interface Contact {
  email: string;
  name: string;
}

// The picker reads its candidates from GET /api/email/contacts?q=… — the same
// suggestion source the type-ahead uses. Each test seeds what that returns.
function stubContacts(rows: Contact[]) {
  const spy = vi.fn(
    async () =>
      new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ContactPicker — search", () => {
  it("lists a matching contact as the user types", async () => {
    stubContacts([{ email: "homer@aaa.com", name: "Homer Owner" }]);

    render(<ContactPicker addedRecipients={[]} onSelect={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/search contacts/i), {
      target: { value: "homer" },
    });

    expect(
      await screen.findByRole("button", { name: /Homer Owner/i }),
    ).toBeDefined();
  });

  it("fires onSelect with the chosen contact when one is clicked", async () => {
    const chosen = { email: "marge@aaa.com", name: "Marge Owner" };
    stubContacts([chosen]);
    const onSelect = vi.fn();

    render(<ContactPicker addedRecipients={[]} onSelect={onSelect} />);

    fireEvent.change(screen.getByPlaceholderText(/search contacts/i), {
      target: { value: "marge" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /Marge Owner/i }),
    );

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toEqual(chosen);
  });

  it("excludes a contact already on the To field from the list", async () => {
    stubContacts([
      { email: "homer@aaa.com", name: "Homer Owner" },
      { email: "marge@aaa.com", name: "Marge Owner" },
    ]);

    render(
      <ContactPicker
        addedRecipients={[{ email: "homer@aaa.com", name: "" }]}
        onSelect={() => {}}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/search contacts/i), {
      target: { value: "owner" },
    });

    // Marge (not yet added) is offered; Homer (already on To) is not.
    expect(
      await screen.findByRole("button", { name: /Marge Owner/i }),
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /Homer Owner/i }),
    ).toBeNull();
  });
});
