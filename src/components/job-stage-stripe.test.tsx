import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { getJobStatusPresentation } from "@/lib/job-status-presentation";
import { JobStageStripe } from "./job-stage-stripe";
import { asRenderedColor } from "./jobs-test-helpers";

describe("JobStageStripe — stage accent color", () => {
  it("paints Lost's rose accent for a cancelled job", () => {
    render(<JobStageStripe status="cancelled" />);

    const stripe = screen.getByTestId("stage-stripe");
    // Source of truth for the color is the #720 presentation module.
    expect(stripe.style.backgroundColor).toBe(
      asRenderedColor(getJobStatusPresentation("cancelled").accentColor),
    );
  });

  // The headline acceptance criterion: the stripe color matches the stage
  // for every one of the five frozen lifecycle keys (ADR 0022).
  it.each([
    ["new"], // Lead
    ["in_progress"], // Active
    ["pending_invoice"], // Collections
    ["completed"], // Closed
    ["cancelled"], // Lost
  ])("paints the %s stage's own accent color", (status) => {
    render(<JobStageStripe status={status} />);

    const stripe = screen.getByTestId("stage-stripe");
    expect(stripe.style.backgroundColor).toBe(
      asRenderedColor(getJobStatusPresentation(status).accentColor),
    );
  });
});

describe("JobStageStripe — layout & semantics", () => {
  it("renders as a left-edge, full-height bar", () => {
    render(<JobStageStripe status="new" />);

    const stripe = screen.getByTestId("stage-stripe");
    for (const token of ["absolute", "inset-y-0", "left-0", "w-1"]) {
      expect(stripe.className).toContain(token);
    }
  });

  it("is decorative — hidden from assistive tech and ignores pointer events", () => {
    render(<JobStageStripe status="new" />);

    const stripe = screen.getByTestId("stage-stripe");
    // It sits atop a clickable card, so it must not steal the click...
    expect(stripe.className).toContain("pointer-events-none");
    // ...and it carries no information a screen reader needs.
    expect(stripe.getAttribute("aria-hidden")).toBe("true");
  });

  it("merges a caller-supplied className onto its base classes", () => {
    // Consumers extend the stripe per variant (e.g. corner rounding).
    render(<JobStageStripe status="new" className="rounded-l-xl" />);

    const stripe = screen.getByTestId("stage-stripe");
    expect(stripe.className).toContain("rounded-l-xl"); // caller's class kept
    expect(stripe.className).toContain("left-0"); // base classes not clobbered
  });
});

describe("JobStageStripe — Lost vs. Closed distinctness", () => {
  // The acceptance criterion calls these out explicitly: Lost (cancelled) is
  // a muted rose, Closed (completed) is grey, and a glance must tell them apart
  // even though both read as "ended" today.
  it("paints Lost and Closed in clearly different colors", () => {
    // Scope each query to its own render's container so the two stripes
    // (both mounted on document.body) don't collide.
    const { container: lostC } = render(<JobStageStripe status="cancelled" />);
    const lost = within(lostC).getByTestId("stage-stripe").style.backgroundColor;

    const { container: closedC } = render(<JobStageStripe status="completed" />);
    const closed = within(closedC).getByTestId("stage-stripe").style
      .backgroundColor;

    expect(lost).not.toBe(closed);
  });
});
