// design-v2 step 3 (#913) — the shared Skeleton per docs/design-system.md §5:
// shimmer-free --muted blocks matching the final layout shape. Decorative, so
// aria-hidden. No jest-dom matchers (none configured) — plain Vitest.

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { Skeleton } from "./skeleton";

describe("<Skeleton> (#913, design-system §5)", () => {
  it("renders a muted, decorative block", () => {
    const { container } = render(<Skeleton />);
    const block = container.firstChild as HTMLElement;

    expect(block).not.toBeNull();
    expect(block.className).toContain("bg-muted");
    expect(block.getAttribute("aria-hidden")).toBe("true");
  });

  it("is shimmer-free (no animation classes)", () => {
    const { container } = render(<Skeleton />);
    const block = container.firstChild as HTMLElement;

    expect(block.className).not.toContain("animate");
  });

  it("merges a caller className for sizing to the layout shape", () => {
    const { container } = render(<Skeleton className="h-8 w-24" />);
    const block = container.firstChild as HTMLElement;

    expect(block.className).toContain("h-8");
    expect(block.className).toContain("w-24");
    // still the muted block underneath the sizing
    expect(block.className).toContain("bg-muted");
  });
});
