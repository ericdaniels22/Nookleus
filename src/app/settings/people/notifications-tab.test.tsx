import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// #228 — Notifications is a per-user (not per-organization) setting. The
// tab heading or subtitle has to make that clear so admins don't think
// they're changing org-wide preferences. Exact copy isn't pinned — the
// test asserts an intent ("personal" / "only affects you" / similar).

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: async () => ({ data: [] }) }),
    }),
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

import { NotificationsTab } from "./notifications-tab";

describe("NotificationsTab — personal-setting disclosure", () => {
  it("surfaces the per-user nature in the header", () => {
    render(<NotificationsTab />);

    // Either "personal setting" or wording about only affecting the
    // viewer — either way, a reasonable disclosure should match.
    const disclosure = screen.queryByText(
      /personal setting|only affects? you|only you|just you/i
    );
    expect(disclosure).not.toBeNull();
  });
});
