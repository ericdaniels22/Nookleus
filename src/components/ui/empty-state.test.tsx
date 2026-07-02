// design-v2 step 3 (#913) — the shared EmptyState per docs/design-system.md
// §5: muted Lucide icon + one-line headline + one-line body + a CTA verb.
// Never a bare dashed box. This primitive is reused by every empty widget in
// later passes. No jest-dom matchers (none configured) — plain Vitest.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Clock } from "lucide-react";

import { EmptyState } from "./empty-state";

describe("<EmptyState> (#913, design-system §5)", () => {
  it("renders the headline and body copy", () => {
    render(
      <EmptyState
        title="No one's on the clock"
        description="Clock in to start tracking time on a job."
      />,
    );

    expect(screen.getByText("No one's on the clock")).toBeTruthy();
    expect(
      screen.getByText("Clock in to start tracking time on a job."),
    ).toBeTruthy();
  });

  it("renders the supplied Lucide icon as a muted, decorative svg", () => {
    const { container } = render(
      <EmptyState icon={Clock} title="No one's on the clock" />,
    );

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("class")).toContain("text-muted-foreground");
  });

  it("renders the CTA action so it's never a bare box", () => {
    render(
      <EmptyState
        icon={Clock}
        title="No one's on the clock"
        action={<button type="button">Clock in</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "Clock in" })).toBeTruthy();
  });
});
