import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Avatar } from "./avatar";

describe("Avatar (design-system §5)", () => {
  it("shows the contact's initials", () => {
    render(<Avatar name="Jane Doe" />);
    expect(screen.getByText("JD")).toBeDefined();
  });

  it("exposes the full name to assistive tech as an image label", () => {
    render(<Avatar name="Jane Doe" />);
    expect(screen.getByRole("img", { name: "Jane Doe" })).toBeDefined();
  });

  it("defaults to the row footprint and takes the larger header footprint on request", () => {
    const { rerender } = render(<Avatar name="Jane Doe" />);
    expect(screen.getByRole("img").dataset.size).toBe("row");
    rerender(<Avatar name="Jane Doe" size="header" />);
    expect(screen.getByRole("img").dataset.size).toBe("header");
  });

  it("hides itself from assistive tech when decorative, still showing the monogram", () => {
    render(<Avatar name="Jane Doe" decorative />);
    // No img role/label to duplicate the adjacent visible name...
    expect(screen.queryByRole("img")).toBeNull();
    // ...but the glyphs are still there for sighted users.
    expect(screen.getByText("JD")).toBeDefined();
  });
});
