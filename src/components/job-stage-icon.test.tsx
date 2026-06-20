import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { Sprout } from "lucide-react";

import { JobStageIcon } from "./job-stage-icon";
import { expectedStageIconGeometry } from "./jobs-test-helpers";

// lucide aliases some exports to renamed canonical glyphs (e.g. CheckCircle2 →
// the "circle-check" icon), so a class-name assertion would be brittle. Anchor
// on the rendered path geometry instead: two renders of the same lucide icon
// produce identical inner SVG markup regardless of the wrapper's attributes.
function geometryOf(ui: ReactElement): string {
  const { container } = render(ui);
  return container.querySelector("svg")!.innerHTML;
}

describe("JobStageIcon — renders the stage's icon", () => {
  it("shows the Lead stage's sprout for a new job", () => {
    const { container } = render(<JobStageIcon status="new" />);
    const icon = container.querySelector('[data-testid="stage-icon"]');

    expect(icon).not.toBeNull();
    expect(icon!.innerHTML).toBe(geometryOf(<Sprout />));
  });

  // The headline acceptance criterion: the rendered glyph matches the stage
  // for every one of the five frozen lifecycle keys (ADR 0022). The expected
  // icon is derived from the #720 presentation module, the single source of
  // truth, so this can never silently drift from it.
  it.each([
    ["new"], // Lead — sprout
    ["in_progress"], // Active — hammer
    ["pending_invoice"], // Collections — banknote
    ["completed"], // Closed — circle-check
    ["cancelled"], // Lost — frown
  ])("renders the %s stage's own icon", (status) => {
    const { container } = render(<JobStageIcon status={status} />);
    const icon = container.querySelector('[data-testid="stage-icon"]');

    expect(icon!.innerHTML).toBe(expectedStageIconGeometry(status));
  });
});

describe("JobStageIcon — styling & semantics", () => {
  it("is decorative — hidden from assistive tech (the badge carries the label)", () => {
    const { container } = render(<JobStageIcon status="new" />);
    const icon = container.querySelector('[data-testid="stage-icon"]');

    expect(icon!.getAttribute("aria-hidden")).toBe("true");
  });

  it("merges a caller-supplied className onto its base classes", () => {
    // Consumers tune the icon per variant (color, sizing) via className.
    const { container } = render(
      <JobStageIcon status="new" className="text-muted-foreground" />,
    );
    const icon = container.querySelector('[data-testid="stage-icon"]');

    expect(icon!.classList.contains("text-muted-foreground")).toBe(true); // caller's class kept
    expect(icon!.classList.contains("shrink-0")).toBe(true); // base class not clobbered
  });

  it("renders compact by default so it sits inline with the status badge", () => {
    const { container } = render(<JobStageIcon status="new" />);
    const icon = container.querySelector('[data-testid="stage-icon"]');

    // Not lucide's 24px default — sized to pair with the small status badge,
    // matching the card's other inline glyphs (MapPin/User at 14px).
    expect(icon!.getAttribute("width")).toBe("14");
    expect(icon!.getAttribute("height")).toBe("14");
  });

  it("falls back to a neutral circle for an unrecognized status", () => {
    const { container } = render(<JobStageIcon status="totally-unknown" />);
    const icon = container.querySelector('[data-testid="stage-icon"]');

    // Mirrors the presentation module's unknown-key fallback (icon: "Circle"),
    // so a bad/legacy status still renders a glyph rather than crashing.
    expect(icon!.innerHTML).toBe(expectedStageIconGeometry("totally-unknown"));
  });
});

describe("JobStageIcon — Lost vs. Closed distinctness", () => {
  // The relabel calls these out: Lost (cancelled) and Closed (completed) both
  // read as "ended", so a glance must still tell them apart by glyph alone —
  // a frown vs. a circle-check. Guards a map typo from collapsing the two.
  it("draws Lost and Closed as visibly different glyphs", () => {
    const { container: lostC } = render(<JobStageIcon status="cancelled" />);
    const { container: closedC } = render(<JobStageIcon status="completed" />);

    const lost = lostC.querySelector('[data-testid="stage-icon"]')!.innerHTML;
    const closed = closedC.querySelector('[data-testid="stage-icon"]')!.innerHTML;

    expect(lost).not.toBe(closed);
  });

  it("draws all five stages as distinct glyphs", () => {
    // AC #2 read as a whole: every stage is tellable from every other at a
    // glance. Asserting distinctness directly also catches a presentation-
    // module collapse (two stages sharing one icon) that the per-stage oracle,
    // which reads the same module, would not.
    const stages = ["new", "in_progress", "pending_invoice", "completed", "cancelled"];
    const geometries = stages.map((status) => {
      const { container } = render(<JobStageIcon status={status} />);
      return container.querySelector('[data-testid="stage-icon"]')!.innerHTML;
    });

    expect(new Set(geometries).size).toBe(stages.length);
  });
});
