// Issue #909 — design v2 step 1: the app is dark-only, so the Light/Dark/System
// theme picker is removed from Settings → Company → Appearance. Brand Colors
// (and the /api/settings/appearance route behind it) stay exactly as they were.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { AppearanceSection } from "./appearance-section";

describe("AppearanceSection — dark-only, no theme picker (#909)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps Brand Colors but ships no Light/Dark/System picker", async () => {
    render(<AppearanceSection />);

    // Brand Colors survives (waits out the mounted/loading gate).
    expect(await screen.findByText("Brand Colors")).toBeDefined();

    // The theme picker is gone.
    expect(screen.queryByText("Light")).toBeNull();
    expect(screen.queryByText("System")).toBeNull();
    expect(screen.queryByText(/Choose how the platform looks/)).toBeNull();
  });
});
