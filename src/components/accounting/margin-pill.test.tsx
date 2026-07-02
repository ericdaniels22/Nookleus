import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { MarginPctPill } from "./margin-pill";

describe("<MarginPctPill> §2.6 tint treatment", () => {
  it("renders each band with a palette tint class and no inline hex", () => {
    // green ≥30, amber ≥10, red <10 (marginPctBand thresholds)
    const green = render(<MarginPctPill pct={45} />).getByText("45.0%");
    const amber = render(<MarginPctPill pct={20} />).getByText("20.0%");
    const red = render(<MarginPctPill pct={5} />).getByText("5.0%");

    for (const el of [green, amber, red]) {
      // §2.6 is a tint-not-fill wash driven by palette classes, never an
      // inline hex/rgba pair.
      expect(el.getAttribute("style")).toBeFalsy();
      expect(el.className).toContain("tabular-nums");
    }

    // The bands stay visually distinct via distinct palette hues.
    expect(green.className).toContain("emerald");
    expect(amber.className).toContain("amber");
    expect(red.className).toContain("red");
  });

  it("renders an em-dash for a null margin", () => {
    const dash = render(<MarginPctPill pct={null} />).getByText("—");
    expect(dash.className).toContain("text-muted-foreground");
  });
});
