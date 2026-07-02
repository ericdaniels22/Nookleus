// design-v2 step 2 (#912) — the shared page header per docs/design-system.md
// §4: title + subtitle left, secondary action(s) + the single primary action
// right. Type scale per §3: title 20px/600 neutral, subtitle 13px/400
// --muted-foreground.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import PageHeader from "./page-header";

describe("PageHeader (#912, design-system §3/§4)", () => {
  it("renders the title as the page's h1 at 20px/600 with a muted 13px subtitle", () => {
    render(
      <PageHeader title="Jobs" subtitle="Track and manage all your jobs." />,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Jobs" });
    expect(heading.className).toContain("text-xl");
    expect(heading.className).toContain("font-semibold");

    const subtitle = screen.getByText("Track and manage all your jobs.");
    expect(subtitle.className).toContain("text-[13px]");
    expect(subtitle.className).toContain("text-muted-foreground");
  });

  it("puts actions on the right and omits the subtitle line when not given", () => {
    render(
      <PageHeader
        title="Contacts"
        actions={<button type="button">New contact</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "New contact" })).toBeTruthy();
    // No stray empty subtitle node.
    expect(
      screen.getByRole("heading", { level: 1 }).parentElement!.querySelector("p"),
    ).toBeNull();
  });
});
