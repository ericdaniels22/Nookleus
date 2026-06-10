// PRD #304 — Nookleus Phone. Slice 11 (#315).
//
// Settings → Phone → Recording tab. The org-level "Record calls by default"
// toggle. Any teammate sees the current state (read-only); only an admin can
// flip it (ADR 0005 — org-wide recording is a Shared-scope admin action).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/auth-context", () => ({
  useAuth: vi.fn(),
}));

import { RecordingSettingsTab } from "./recording-settings-tab";
import { useAuth } from "@/lib/auth-context";

const mockFetch = vi.fn();

function authAs(role: "admin" | "crew_lead") {
  vi.mocked(useAuth).mockReturnValue({ profile: { role } } as never);
}

// Route GET → the current value; PATCH → success. Returns the spy so a test
// can inspect the PATCH body.
function stubFetch(current: boolean) {
  mockFetch.mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/api/phone/recording-settings") && init?.method === "PATCH") {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (url.includes("/api/phone/recording-settings")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ recording_enabled_default: current }),
      };
    }
    throw new Error(`unmocked fetch: ${url}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mockFetch as never;
});
afterEach(() => vi.restoreAllMocks());

describe("RecordingSettingsTab", () => {
  it("reflects the current org default (checked when recording is on)", async () => {
    authAs("admin");
    stubFetch(true);

    render(<RecordingSettingsTab />);

    const toggle = (await screen.findByRole("checkbox", {
      name: /record calls by default/i,
    })) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it("an admin toggles the default on and PATCHes the new value", async () => {
    authAs("admin");
    stubFetch(false);

    render(<RecordingSettingsTab />);

    const toggle = await screen.findByRole("checkbox", {
      name: /record calls by default/i,
    });
    fireEvent.click(toggle);

    await waitFor(() => {
      const patch = mockFetch.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({
        recording_enabled_default: true,
      });
    });
  });

  it("disables the toggle for a non-admin", async () => {
    authAs("crew_lead");
    stubFetch(true);

    render(<RecordingSettingsTab />);

    const toggle = (await screen.findByRole("checkbox", {
      name: /record calls by default/i,
    })) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
  });

  it("quotes the canonical consent notice so admins know what callers hear", async () => {
    authAs("admin");
    stubFetch(true);

    render(<RecordingSettingsTab />);

    expect(
      await screen.findByText(/this call may be recorded for quality and reference/i),
    ).toBeDefined();
  });
});
