import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// #142 — the Settings → Email management view brings the UI in line with
// the access module's Shared/Personal matrix. These light UI tests cover
// what the component itself decides: which fetch view it asks for, how it
// labels each account's kind, and whether the connect dialog offers an
// Owner picker. Route-level access (canRead/canSee/canManage, ownership)
// is already covered by the #139 / #141 route + module suites.
//
// #229 — the body that used to live in /settings/email/page.tsx is now
// the AccountsTab inside the combined /settings/email shell. Tests moved
// alongside the body; behavior is unchanged.

// `useAuth` is the component's only source of the caller's role. A hoisted
// mutable holder lets each test set admin vs non-admin before render.
const auth = vi.hoisted(() => ({
  value: {
    profile: null as { id: string; full_name: string; role: string } | null,
    loading: false,
  },
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => auth.value,
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { AccountsTab } from "./accounts-tab";

type Account = {
  id: string;
  user_id: string | null;
  label: string;
  email_address: string;
  display_name: string;
  provider: string;
  signature: string | null;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  username: string;
  is_active: boolean;
  is_default: boolean;
  color: string | null;
  last_synced_at: string | null;
  created_at: string;
};

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    user_id: null,
    label: "Main Office",
    email_address: "office@example.com",
    display_name: "AAA",
    provider: "hostinger",
    signature: null,
    imap_host: "imap.example.com",
    imap_port: 993,
    smtp_host: "smtp.example.com",
    smtp_port: 465,
    username: "office@example.com",
    is_active: true,
    is_default: false,
    color: "#2563eb",
    last_synced_at: null,
    created_at: "2026-05-20T00:00:00Z",
    ...overrides,
  };
}

type Member = { id: string; full_name: string; email: string; role: string };

function stubFetch({
  accounts = [],
  members = [],
}: { accounts?: Account[]; members?: Member[] } = {}) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/email/accounts")) {
      if (init?.method === "POST") return json({ id: "new-acc" }, 201);
      return json(accounts);
    }
    if (url.startsWith("/api/settings/users")) return json(members);
    return json({});
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

// The JSON body of the connect-dialog POST to /api/email/accounts.
function postBody(spy: ReturnType<typeof stubFetch>): Record<string, unknown> | null {
  const call = spy.mock.calls.find(
    (c) =>
      String(c[0]).startsWith("/api/email/accounts") &&
      (c[1] as RequestInit | undefined)?.method === "POST",
  );
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : null;
}

function asAdmin(id = "admin-1", full_name = "Ada Admin") {
  auth.value = { profile: { id, full_name, role: "admin" }, loading: false };
}
function asNonAdmin(id = "user-1", full_name = "Nick NonAdmin") {
  auth.value = { profile: { id, full_name, role: "crew_lead" }, loading: false };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AccountsTab — connect dialog Owner picker (#142)", () => {
  it("renders an Owner picker in the connect dialog for an admin", async () => {
    asAdmin();
    stubFetch({
      members: [
        { id: "admin-1", full_name: "Ada Admin", email: "ada@x.com", role: "admin" },
        { id: "user-1", full_name: "Nick NonAdmin", email: "nick@x.com", role: "crew_lead" },
      ],
    });

    render(<AccountsTab />);

    fireEvent.click(
      await screen.findByRole("button", { name: /add email account/i }),
    );

    expect(screen.getByRole("combobox", { name: /owner/i })).toBeDefined();
  });

  it("omits the Owner picker in the connect dialog for a non-admin", async () => {
    asNonAdmin();
    stubFetch();

    render(<AccountsTab />);

    fireEvent.click(
      await screen.findByRole("button", { name: /add email account/i }),
    );

    // The connect dialog itself is open (its provider select is present)…
    expect(screen.getByText("Email Provider")).toBeDefined();
    // …but a non-admin gets no Owner picker — they are auto-assigned owner.
    expect(screen.queryByRole("combobox", { name: /owner/i })).toBeNull();
  });
});

describe("AccountsTab — account kind label (#142)", () => {
  it("shows a 'Shared' badge on a Shared account row", async () => {
    asNonAdmin();
    stubFetch({
      accounts: [account({ id: "s1", user_id: null, label: "Front Desk" })],
    });

    render(<AccountsTab />);

    expect(await screen.findByText("Front Desk")).toBeDefined();
    expect(screen.getByText("Shared")).toBeDefined();
  });

  it("shows 'Owner: <name>' on a Personal account row, resolving the name from the member list", async () => {
    asAdmin();
    stubFetch({
      accounts: [account({ id: "p1", user_id: "user-7", label: "Jane's Inbox" })],
      members: [
        { id: "user-7", full_name: "Jane Tradesman", email: "jane@x.com", role: "crew_member" },
      ],
    });

    render(<AccountsTab />);

    expect(await screen.findByText("Jane's Inbox")).toBeDefined();
    // The member-list fetch resolves the owner uuid to a display name.
    expect(await screen.findByText(/Owner: Jane Tradesman/)).toBeDefined();
    expect(screen.queryByText("Shared")).toBeNull();
  });
});

describe("AccountsTab — which account view is fetched (#142)", () => {
  it("an admin requests the org-wide admin view (?asAdmin=true)", async () => {
    asAdmin();
    const spy = stubFetch({ accounts: [account()] });

    render(<AccountsTab />);
    await screen.findByText("Main Office");

    const accountUrls = spy.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.startsWith("/api/email/accounts"));
    expect(accountUrls.some((u) => u.includes("asAdmin=true"))).toBe(true);
  });

  it("a non-admin requests only their readable accounts — no admin view, no member list", async () => {
    asNonAdmin();
    const spy = stubFetch({ accounts: [account()] });

    render(<AccountsTab />);
    await screen.findByText("Main Office");

    const urls = spy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.startsWith("/api/email/accounts"))).toBe(true);
    expect(urls.some((u) => u.includes("asAdmin=true"))).toBe(false);
    // A non-admin has no business enumerating the Organization's members.
    expect(urls.some((u) => u.startsWith("/api/settings/users"))).toBe(false);
  });
});

describe("AccountsTab — owner assigned when connecting an account (#142)", () => {
  it("a non-admin's new account is owned by the caller", async () => {
    asNonAdmin("user-1");
    const spy = stubFetch();

    const { container } = render(<AccountsTab />);
    fireEvent.click(
      await screen.findByRole("button", { name: /add email account/i }),
    );

    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => {
      expect(postBody(spy)).toMatchObject({ user_id: "user-1" });
    });
  });

  it("an admin's new account is owned by the member chosen in the Owner picker", async () => {
    asAdmin();
    const spy = stubFetch({
      members: [
        { id: "user-9", full_name: "Pat Picked", email: "pat@x.com", role: "crew_member" },
      ],
    });

    const { container } = render(<AccountsTab />);
    fireEvent.click(
      await screen.findByRole("button", { name: /add email account/i }),
    );

    fireEvent.change(await screen.findByRole("combobox", { name: /owner/i }), {
      target: { value: "user-9" },
    });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => {
      expect(postBody(spy)).toMatchObject({ user_id: "user-9" });
    });
  });

  it("an admin's new account is Shared (no owner) when the Owner picker is left on Shared", async () => {
    asAdmin();
    const spy = stubFetch();

    const { container } = render(<AccountsTab />);
    fireEvent.click(
      await screen.findByRole("button", { name: /add email account/i }),
    );

    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => {
      expect(postBody(spy)).toMatchObject({ user_id: null });
    });
  });
});
