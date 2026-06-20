// Shared test helpers for the Jobs row/card component suites.

import { createElement } from "react";
import { render } from "@testing-library/react";
import {
  Sprout,
  Hammer,
  Banknote,
  CheckCircle2,
  Frown,
  Circle,
  type LucideIcon,
} from "lucide-react";

import { getJobStatusPresentation } from "@/lib/job-status-presentation";

// The lucide export keyed by the icon NAME the #720 presentation module
// records for each stage. Lets a test name the expected glyph the same way
// production code does — through the source of truth — without coupling to
// lucide's class naming (some exports, e.g. CheckCircle2, render a renamed
// "circle-check" class).
const LUCIDE_BY_NAME: Record<string, LucideIcon> = {
  Sprout,
  Hammer,
  Banknote,
  CheckCircle2,
  Frown,
  Circle,
};

/**
 * The inner SVG path markup lucide renders for the icon a status maps to, per
 * the #720 presentation module — the oracle for "the right stage icon shows".
 * Geometry is independent of size / className / wrapper attributes, so it
 * compares like-for-like against a rendered JobStageIcon.
 */
export function expectedStageIconGeometry(status: string): string {
  const Icon = LUCIDE_BY_NAME[getJobStatusPresentation(status).icon] ?? Circle;
  const { container } = render(createElement(Icon));
  return container.querySelector("svg")!.innerHTML;
}

/**
 * jsdom's CSSOM serializes an inline `background-color` to its `rgb(...)`
 * form on read-back, so a hex written in (`#E44B4A`) reads out as
 * `rgb(228, 75, 74)`. Round-trip a hex accent through the same CSSOM here so
 * a stripe-color assertion compares like-for-like and stays tied to the #720
 * presentation module as the single source of truth for the color.
 */
export function asRenderedColor(hex: string): string {
  const probe = document.createElement("span");
  probe.style.backgroundColor = hex;
  return probe.style.backgroundColor;
}
