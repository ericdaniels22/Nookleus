// on-site-now — the per-Job Presence indicator (#705, epic #699). It answers
// "who is On site at THIS Job right now?" with NAMES ONLY — no hour totals, no
// location (ADR 0019). It rides on the Job page and the Job card, both already
// gated by view_jobs, so it carries no permission gate of its own.
//
// OnSiteNowView is the pure presentational core: given the names of the app
// Users currently On site, it renders a compact live indicator, or nothing at
// all when no one is on site (it's a badge, not a panel). The realtime wiring
// lives in the container (OnSiteNow) below.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { OnSiteNowView } from "./on-site-now";

afterEach(cleanup);

describe("OnSiteNowView (#705)", () => {
  it("names the app Users currently on site", () => {
    render(<OnSiteNowView names={["Jordan Rivera", "Sam Diaz"]} />);

    expect(screen.getByText(/on site now/i)).toBeTruthy();
    expect(screen.getByText(/Jordan Rivera/)).toBeTruthy();
    expect(screen.getByText(/Sam Diaz/)).toBeTruthy();
  });

  it("renders nothing when no one is on site (a presence badge, not an empty state)", () => {
    const { container } = render(<OnSiteNowView names={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
