// #612 — the Website (WordPress) connection card in Connections settings.
//
// Unlike Google's OAuth redirect, WordPress is a pasted credential: the admin
// types the site URL, username, and an Application Password into a form, and
// Save validates them against the live WordPress REST API server-side. These
// tests drive the public behavior through the DOM: the three states the card
// renders, what the Save POST carries, and that the password never leaks back.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import WebsiteConnectionCard from "./website-connection-card";
import type { WebsiteConnectionSummary } from "@/lib/website/types";

function disconnectedSummary(): WebsiteConnectionSummary {
  return {
    state: "disconnected",
    provider: null,
    site_url: null,
    username: null,
    account_name: null,
    broken_reason: null,
    connected_at: null,
  };
}

function connectedSummary(
  over: Partial<WebsiteConnectionSummary> = {},
): WebsiteConnectionSummary {
  return {
    state: "connected",
    provider: "wordpress",
    site_url: "https://aaadisasterrecovery.com",
    username: "marketing",
    account_name: "AAA Disaster Recovery",
    broken_reason: null,
    connected_at: "2026-06-27T11:00:00.000Z",
    ...over,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// A fetch stub routed by URL + method. connect/disconnect/connection are the
// only endpoints the card touches.
function stubFetch(opts: {
  connect?: { status?: number; body?: unknown };
  disconnect?: { status?: number; body?: unknown };
  connection?: unknown;
}) {
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/website/connect" && init?.method === "POST") {
      return json(opts.connect?.body ?? connectedSummary(), opts.connect?.status ?? 200);
    }
    if (url === "/api/website/disconnect" && init?.method === "POST") {
      return json(opts.disconnect?.body ?? { ok: true }, opts.disconnect?.status ?? 200);
    }
    if (url === "/api/website/connection") {
      return json(opts.connection ?? disconnectedSummary());
    }
    return json({});
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

async function postBody(
  fetchSpy: ReturnType<typeof vi.fn>,
  endpoint: string,
): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> | undefined;
  await waitFor(() => {
    const call = fetchSpy.mock.calls.find(
      (c) =>
        String(c[0]) === endpoint &&
        (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(call).toBeDefined();
    body = JSON.parse(String((call![1] as RequestInit).body));
  });
  return body!;
}

const fields = () => ({
  siteUrl: screen.getByLabelText(/site address|site url|website address/i) as HTMLInputElement,
  username: screen.getByLabelText(/username/i) as HTMLInputElement,
  password: screen.getByLabelText(/application password/i) as HTMLInputElement,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WebsiteConnectionCard — connecting (#612)", () => {
  it("posts the entered credentials and flips to connected", async () => {
    const fetchSpy = stubFetch({ connect: { body: connectedSummary() } });

    render(<WebsiteConnectionCard initial={disconnectedSummary()} />);

    const f = fields();
    fireEvent.change(f.siteUrl, { target: { value: "aaadisasterrecovery.com" } });
    fireEvent.change(f.username, { target: { value: "marketing" } });
    fireEvent.change(f.password, { target: { value: "abcd efgh ijkl mnop" } });
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    const body = await postBody(fetchSpy, "/api/website/connect");
    expect(body).toEqual({
      siteUrl: "aaadisasterrecovery.com",
      username: "marketing",
      applicationPassword: "abcd efgh ijkl mnop",
    });

    // On success the card shows the connected account and a Disconnect control.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /disconnect/i })).toBeDefined();
    });
    expect(screen.getByText(/aaadisasterrecovery\.com/i)).toBeDefined();
  });

  it("surfaces a connect failure as an error and stays on the form", async () => {
    stubFetch({ connect: { status: 422, body: { error: "cannot_publish_posts" } } });

    render(<WebsiteConnectionCard initial={disconnectedSummary()} />);

    const f = fields();
    fireEvent.change(f.siteUrl, { target: { value: "aaadisasterrecovery.com" } });
    fireEvent.change(f.username, { target: { value: "marketing" } });
    fireEvent.change(f.password, { target: { value: "wrong pass word here" } });
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // Stays on the form — no connected view, no Disconnect.
    expect(screen.queryByRole("button", { name: /disconnect/i })).toBeNull();
    expect(screen.getByLabelText(/application password/i)).toBeDefined();
  });
});

describe("WebsiteConnectionCard — connected & disconnect (#612)", () => {
  it("shows the linked site and account when connected", () => {
    stubFetch({});
    render(<WebsiteConnectionCard initial={connectedSummary()} />);

    expect(screen.getByText(/aaadisasterrecovery\.com/i)).toBeDefined();
    expect(screen.getByText(/AAA Disaster Recovery/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /disconnect/i })).toBeDefined();
    // No credential form while connected.
    expect(screen.queryByLabelText(/application password/i)).toBeNull();
  });

  it("disconnects and returns to the credential form", async () => {
    const fetchSpy = stubFetch({
      disconnect: { body: { ok: true } },
      connection: disconnectedSummary(),
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<WebsiteConnectionCard initial={connectedSummary()} />);
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));

    // POSTs to the disconnect endpoint.
    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(
          (c) =>
            String(c[0]) === "/api/website/disconnect" &&
            (c[1] as RequestInit | undefined)?.method === "POST",
        ),
      ).toBe(true);
    });
    // Refreshes to the (now disconnected) summary → the form is back.
    await waitFor(() => {
      expect(screen.getByLabelText(/application password/i)).toBeDefined();
    });
    confirmSpy.mockRestore();
  });

  it("returns to the form after a successful disconnect even if the refetch fails", async () => {
    // Disconnect deleted the row server-side. If the follow-up GET blips, the
    // card must still reflect disconnected — not strand the admin on a stale
    // "connected" view for a credential that no longer exists.
    const spy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/website/disconnect" && init?.method === "POST") {
        return json({ ok: true }, 200);
      }
      if (url === "/api/website/connection") {
        return json({ error: "boom" }, 500);
      }
      return json({});
    });
    vi.stubGlobal("fetch", spy);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<WebsiteConnectionCard initial={connectedSummary()} />);
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/application password/i)).toBeDefined();
    });
    expect(screen.queryByRole("button", { name: /disconnect/i })).toBeNull();
    confirmSpy.mockRestore();
  });

  it("re-enables Disconnect and shows an error when the disconnect request throws", async () => {
    const spy = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", spy);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<WebsiteConnectionCard initial={connectedSummary()} />);
    const btn = screen.getByRole("button", { name: /disconnect/i }) as HTMLButtonElement;
    fireEvent.click(btn);

    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // The request failed with the server state unknown — stay connected, but
    // free the button so the admin can retry instead of being wedged.
    await waitFor(() => expect(btn.disabled).toBe(false));
    expect(screen.getByRole("button", { name: /disconnect/i })).toBeDefined();
    confirmSpy.mockRestore();
  });

  it("does not disconnect when the confirm is dismissed", async () => {
    const fetchSpy = stubFetch({});
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<WebsiteConnectionCard initial={connectedSummary()} />);
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));

    expect(
      fetchSpy.mock.calls.some((c) => String(c[0]) === "/api/website/disconnect"),
    ).toBe(false);
    // Still connected.
    expect(screen.getByRole("button", { name: /disconnect/i })).toBeDefined();
    confirmSpy.mockRestore();
  });
});

describe("WebsiteConnectionCard — resilience (#612)", () => {
  it("re-enables the form and shows an error when the connect request itself throws", async () => {
    // The site URL is user-supplied — the POST can reject outright (offline,
    // DNS, TLS). Without a catch the submit handler dies after setSubmitting(true)
    // and the button is wedged disabled forever with no feedback.
    const spy = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", spy);

    render(<WebsiteConnectionCard initial={disconnectedSummary()} />);
    const f = fields();
    fireEvent.change(f.siteUrl, { target: { value: "aaadisasterrecovery.com" } });
    fireEvent.change(f.username, { target: { value: "marketing" } });
    fireEvent.change(f.password, { target: { value: "abcd efgh ijkl mnop" } });
    const btn = screen.getByRole("button", { name: /connect/i }) as HTMLButtonElement;
    fireEvent.click(btn);

    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // The button is not stuck disabled — the admin can retry.
    await waitFor(() => expect(btn.disabled).toBe(false));
  });

  it("maps each connect error code to a specific, actionable message", async () => {
    const { toast } = await import("sonner");

    async function messageFor(code: string): Promise<string> {
      vi.mocked(toast.error).mockClear();
      const spy = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/website/connect" && init?.method === "POST") {
          return json({ error: code }, 422);
        }
        return json({});
      });
      vi.stubGlobal("fetch", spy);
      const view = render(<WebsiteConnectionCard initial={disconnectedSummary()} />);
      const f = fields();
      fireEvent.change(f.siteUrl, { target: { value: "x.com" } });
      fireEvent.change(f.username, { target: { value: "u" } });
      fireEvent.change(f.password, { target: { value: "p p p p" } });
      fireEvent.click(screen.getByRole("button", { name: /connect/i }));
      let msg = "";
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalled();
        msg = String(vi.mocked(toast.error).mock.calls.at(-1)?.[0]);
      });
      view.unmount();
      return msg;
    }

    // A wrong/revoked password names the credential, not the address.
    expect(await messageFor("invalid_credentials")).toMatch(/password/i);
    // A valid account that can't write names the publishing permission.
    expect(await messageFor("cannot_publish_posts")).toMatch(/publish/i);
    // The address being unparseable names the address.
    expect(await messageFor("invalid_site_url")).toMatch(/address/i);
    // The two credential/permission cases are genuinely distinct, not one
    // catch-all — the admin learns which thing to fix.
    expect(await messageFor("invalid_credentials")).not.toBe(
      await messageFor("cannot_publish_posts"),
    );
  });
});

describe("WebsiteConnectionCard — broken state (#612)", () => {
  it("shows a reconnect prompt with the broken reason and the form", () => {
    stubFetch({});
    render(
      <WebsiteConnectionCard
        initial={connectedSummary({
          state: "broken",
          broken_reason: "Application password was revoked",
        })}
      />,
    );

    expect(screen.getByText(/website connection needs reconnecting/i)).toBeDefined();
    expect(screen.getByText(/application password was revoked/i)).toBeDefined();
    // The form is available so the admin can re-enter the credential.
    expect(screen.getByLabelText(/application password/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /reconnect/i })).toBeDefined();
  });
});
