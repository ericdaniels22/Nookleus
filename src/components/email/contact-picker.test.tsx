import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

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
      await screen.findByRole("option", { name: /Homer Owner/i }),
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
      await screen.findByRole("option", { name: /Marge Owner/i }),
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
      await screen.findByRole("option", { name: /Marge Owner/i }),
    ).toBeDefined();
    expect(
      screen.queryByRole("option", { name: /Homer Owner/i }),
    ).toBeNull();
  });
});

describe("ContactPicker — Enter guard (issue #659)", () => {
  it("chooses the first matching contact on Enter", async () => {
    stubContacts([{ email: "homer@aaa.com", name: "Homer Owner" }]);
    const onSelect = vi.fn();

    render(<ContactPicker addedRecipients={[]} onSelect={onSelect} />);

    const input = screen.getByPlaceholderText(/search contacts/i);
    fireEvent.change(input, { target: { value: "homer" } });
    // Wait for the candidate to land before pressing Enter.
    await screen.findByRole("option", { name: /Homer Owner/i });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toEqual({
      email: "homer@aaa.com",
      name: "Homer Owner",
    });
  });

  it("prevents the default Enter action so it can't submit the compose form", async () => {
    stubContacts([{ email: "homer@aaa.com", name: "Homer Owner" }]);

    render(<ContactPicker addedRecipients={[]} onSelect={() => {}} />);

    const input = screen.getByPlaceholderText(/search contacts/i);
    fireEvent.change(input, { target: { value: "homer" } });
    await screen.findByRole("option", { name: /Homer Owner/i });

    // fireEvent returns false when the handler called preventDefault — the
    // signal that the surrounding <form>'s implicit submit is suppressed.
    const notCancelled = fireEvent.keyDown(input, { key: "Enter" });
    expect(notCancelled).toBe(false);
  });

  it("still suppresses Enter when there are no matching contacts", () => {
    stubContacts([]);
    const onSelect = vi.fn();

    render(<ContactPicker addedRecipients={[]} onSelect={onSelect} />);

    const input = screen.getByPlaceholderText(/search contacts/i);
    fireEvent.change(input, { target: { value: "nobody" } });

    const notCancelled = fireEvent.keyDown(input, { key: "Enter" });
    expect(notCancelled).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("ContactPicker — combobox semantics (issue #659)", () => {
  it("exposes the search field as a combobox owning a listbox of options", async () => {
    stubContacts([
      { email: "homer@aaa.com", name: "Homer Owner" },
      { email: "marge@aaa.com", name: "Marge Owner" },
    ]);

    render(<ContactPicker addedRecipients={[]} onSelect={() => {}} />);

    const combobox = screen.getByRole("combobox");
    fireEvent.change(combobox, { target: { value: "owner" } });

    // Once candidates land, the field reports itself expanded and points at
    // the active (first) option; the candidates are exposed as a listbox.
    const firstOption = await screen.findByRole("option", {
      name: /Homer Owner/i,
    });
    expect(combobox.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox")).toBeDefined();
    expect(screen.getAllByRole("option")).toHaveLength(2);

    // The active descendant is the first option, and that option is selected.
    expect(combobox.getAttribute("aria-activedescendant")).toBe(
      firstOption.getAttribute("id"),
    );
    expect(firstOption.getAttribute("aria-selected")).toBe("true");
  });

  it("reports itself collapsed before any candidates are shown", () => {
    stubContacts([]);
    render(<ContactPicker addedRecipients={[]} onSelect={() => {}} />);

    const combobox = screen.getByRole("combobox");
    expect(combobox.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("ContactPicker — stale results (issue #659)", () => {
  // A fetch stub whose responses are resolved by hand, keyed on the ?q=… term,
  // so a test can answer a newer query before an older one and prove the late
  // (stale) answer is discarded rather than clobbering the fresh list.
  function controllableFetch() {
    const resolvers = new Map<string, (rows: Contact[]) => void>();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (url: string) =>
          new Promise<Response>((resolve) => {
            const q =
              new URL(url, "http://localhost").searchParams.get("q") ?? "";
            resolvers.set(q, (rows) =>
              resolve(
                new Response(JSON.stringify(rows), {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                }),
              ),
            );
          }),
      ),
    );
    return resolvers;
  }

  it("keeps the latest query's results when an older fetch resolves last", async () => {
    const resolvers = controllableFetch();

    render(<ContactPicker addedRecipients={[]} onSelect={() => {}} />);
    const input = screen.getByPlaceholderText(/search contacts/i);

    // First query fires after the debounce…
    fireEvent.change(input, { target: { value: "ho" } });
    await waitFor(() => expect(resolvers.has("ho")).toBe(true));

    // …then a second, newer query fires.
    fireEvent.change(input, { target: { value: "homer" } });
    await waitFor(() => expect(resolvers.has("homer")).toBe(true));

    // The newer query answers first, then the older (stale) one answers late.
    await act(async () => {
      resolvers.get("homer")!([{ email: "homer@aaa.com", name: "Homer Owner" }]);
    });
    await act(async () => {
      resolvers.get("ho")!([{ email: "hortense@aaa.com", name: "Hortense Old" }]);
    });

    // The fresh result must stand; the late stale one must not clobber it.
    expect(screen.getByText("homer@aaa.com")).toBeDefined();
    expect(screen.queryByText("hortense@aaa.com")).toBeNull();
  });
});
