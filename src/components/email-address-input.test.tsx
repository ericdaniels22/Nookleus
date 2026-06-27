import { createRef } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";

import EmailAddressInput, {
  type EmailAddressInputHandle,
} from "./email-address-input";

// The field fetches type-ahead candidates from GET /api/email/contacts?q=…
// on a debounce. These tests never exercise that path, so we stub it to an
// empty list to keep the effect quiet.
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("[]", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
});

describe("EmailAddressInput — chip validation (issue #659)", () => {
  it("does not commit an incomplete address (foo@) on Enter", () => {
    const onChange = vi.fn();
    render(
      <EmailAddressInput label="To" recipients={[]} onChange={onChange} />,
    );

    const input = screen.getByPlaceholderText(/type name or email/i);
    fireEvent.change(input, { target: { value: "foo@" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("commits a valid address (foo@bar.com) on Enter", () => {
    const onChange = vi.fn();
    render(
      <EmailAddressInput label="To" recipients={[]} onChange={onChange} />,
    );

    const input = screen.getByPlaceholderText(/type name or email/i);
    fireEvent.change(input, { target: { value: "foo@bar.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual([
      { email: "foo@bar.com", name: "" },
    ]);
  });

  it("does not commit an incomplete address (foo@) on comma", () => {
    const onChange = vi.fn();
    render(
      <EmailAddressInput label="To" recipients={[]} onChange={onChange} />,
    );

    const input = screen.getByPlaceholderText(/type name or email/i);
    fireEvent.change(input, { target: { value: "foo@" } });
    fireEvent.keyDown(input, { key: "," });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not commit an incomplete address (foo@) when flush() runs on send", () => {
    const onChange = vi.fn();
    const ref = createRef<EmailAddressInputHandle>();
    render(
      <EmailAddressInput
        ref={ref}
        label="To"
        recipients={[]}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/type name or email/i), {
      target: { value: "foo@" },
    });
    act(() => ref.current?.flush());

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("EmailAddressInput — combobox semantics (issue #659)", () => {
  function stubRows(rows: Array<{ email: string; name: string }>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(rows), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
  }

  it("exposes the field as a combobox owning a listbox of suggestions", async () => {
    stubRows([
      { email: "homer@aaa.com", name: "Homer Owner" },
      { email: "marge@aaa.com", name: "Marge Owner" },
    ]);

    render(<EmailAddressInput label="To" recipients={[]} onChange={() => {}} />);

    const combobox = screen.getByRole("combobox");
    fireEvent.change(combobox, { target: { value: "o" } });

    const firstOption = await screen.findByRole("option", {
      name: /Homer Owner/i,
    });
    expect(combobox.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox")).toBeDefined();
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(combobox.getAttribute("aria-activedescendant")).toBe(
      firstOption.getAttribute("id"),
    );
    expect(firstOption.getAttribute("aria-selected")).toBe("true");
  });

  it("moves the active option as the user arrows down", async () => {
    stubRows([
      { email: "homer@aaa.com", name: "Homer Owner" },
      { email: "marge@aaa.com", name: "Marge Owner" },
    ]);

    render(<EmailAddressInput label="To" recipients={[]} onChange={() => {}} />);

    const combobox = screen.getByRole("combobox");
    fireEvent.change(combobox, { target: { value: "o" } });
    await screen.findByRole("option", { name: /Homer Owner/i });

    fireEvent.keyDown(combobox, { key: "ArrowDown" });

    const marge = screen.getByRole("option", { name: /Marge Owner/i });
    expect(combobox.getAttribute("aria-activedescendant")).toBe(
      marge.getAttribute("id"),
    );
    expect(marge.getAttribute("aria-selected")).toBe("true");
  });

  it("reports itself collapsed when no suggestions are open", () => {
    stubRows([]);
    render(<EmailAddressInput label="To" recipients={[]} onChange={() => {}} />);

    expect(
      screen.getByRole("combobox").getAttribute("aria-expanded"),
    ).toBe("false");
  });
});

describe("EmailAddressInput — stale suggestions (issue #659)", () => {
  // Hand-resolved fetch keyed on ?q=…, so a test can answer a newer query
  // before the older one and prove the late (stale) answer is dropped.
  function controllableFetch() {
    const resolvers = new Map<string, (rows: unknown[]) => void>();
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

  it("keeps the latest query's suggestions when an older fetch resolves last", async () => {
    const resolvers = controllableFetch();

    render(<EmailAddressInput label="To" recipients={[]} onChange={() => {}} />);
    const input = screen.getByPlaceholderText(/type name or email/i);

    fireEvent.change(input, { target: { value: "ho" } });
    await waitFor(() => expect(resolvers.has("ho")).toBe(true));

    fireEvent.change(input, { target: { value: "homer" } });
    await waitFor(() => expect(resolvers.has("homer")).toBe(true));

    // Newer query answers first, then the older (stale) one answers late.
    await act(async () => {
      resolvers.get("homer")!([{ email: "homer@aaa.com", name: "Homer Owner" }]);
    });
    await act(async () => {
      resolvers.get("ho")!([{ email: "hortense@aaa.com", name: "Hortense Old" }]);
    });

    expect(screen.getByText("homer@aaa.com")).toBeDefined();
    expect(screen.queryByText("hortense@aaa.com")).toBeNull();
  });
});
