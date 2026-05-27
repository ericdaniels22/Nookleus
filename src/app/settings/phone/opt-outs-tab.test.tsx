// PRD #304 — Nookleus Phone. Slice 5 (#309).
//
// Settings → Phone → Opt-outs tab. Admin view of the org's opt-out
// registry plus a re-opt-in action that requires a free-text note.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/auth-context", () => ({
  useAuth: vi.fn(),
}));

import { OptOutsTab } from "./opt-outs-tab";
import { useAuth } from "@/lib/auth-context";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mockFetch as never;
});
afterEach(() => vi.restoreAllMocks());

function authAs(role: "admin" | "crew_lead") {
  vi.mocked(useAuth).mockReturnValue({
    profile: { role },
  } as never);
}

const optOutRow = (overrides: Record<string, unknown> = {}) => ({
  id: "oo-1",
  organization_id: "org-1",
  outside_e164: "+15551112222",
  opted_out_at: "2026-05-26T00:00:00Z",
  re_opted_in_at: null as string | null,
  re_opted_in_note: null,
  re_opted_in_by_user_id: null,
  ...overrides,
});

describe("OptOutsTab — list", () => {
  it("renders the formatted phone number and an Opted-out badge for active rows", async () => {
    authAs("admin");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [optOutRow()],
    });

    render(<OptOutsTab />);

    await waitFor(() =>
      expect(screen.getByText("(555) 111-2222")).toBeDefined(),
    );
    expect(screen.getAllByText(/opted out/i).length).toBeGreaterThan(0);
  });

  it("renders a re-opted-in row with the note visible", async () => {
    authAs("admin");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        optOutRow({
          re_opted_in_at: "2026-05-27T00:00:00Z",
          re_opted_in_note: "phone confirmed",
        }),
      ],
    });

    render(<OptOutsTab />);

    await waitFor(() =>
      expect(screen.getByText(/phone confirmed/i)).toBeDefined(),
    );
    expect(screen.getAllByText(/re.?opted.?in/i).length).toBeGreaterThan(0);
  });

  it("renders an empty-state when no opt-outs exist", async () => {
    authAs("admin");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    });

    render(<OptOutsTab />);
    await waitFor(() =>
      expect(screen.getByText(/no opt-outs/i)).toBeDefined(),
    );
  });
});

describe("OptOutsTab — re-opt-in (admin only)", () => {
  it("posts to /re-opt-in with the typed note when admin clicks Re-opt-in", async () => {
    authAs("admin");
    mockFetch.mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      if (path === "/api/phone/opt-outs") {
        return { ok: true, status: 200, json: async () => [optOutRow()] };
      }
      if (path === "/api/phone/opt-outs/oo-1/re-opt-in" && init?.method === "POST") {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      throw new Error(`unmocked: ${path}`);
    });

    render(<OptOutsTab />);
    await screen.findByText("(555) 111-2222");

    fireEvent.click(screen.getByRole("button", { name: /re.?opt.?in/i }));
    const noteInput = (await screen.findByLabelText(/note/i)) as HTMLTextAreaElement;
    fireEvent.change(noteInput, {
      target: { value: "fresh consent — confirmed via phone call" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^confirm/i }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(([url, init]) => {
        const u = typeof url === "string" ? url : (url as Request).url;
        return (
          u.includes("/api/phone/opt-outs/oo-1/re-opt-in") &&
          (init as RequestInit | undefined)?.method === "POST"
        );
      });
      expect(postCall).toBeDefined();
      const body = JSON.parse(
        (postCall![1] as RequestInit).body as string,
      ) as Record<string, unknown>;
      expect(body).toEqual({
        note: "fresh consent — confirmed via phone call",
      });
    });
  });

  it("hides the Re-opt-in action from non-admin callers", async () => {
    authAs("crew_lead");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [optOutRow()],
    });

    render(<OptOutsTab />);
    await screen.findByText("(555) 111-2222");

    expect(screen.queryByRole("button", { name: /re.?opt.?in/i })).toBeNull();
  });
});
