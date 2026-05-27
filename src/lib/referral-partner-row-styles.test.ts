import { describe, expect, it } from "vitest";

import {
  STATUS_ROW_STYLES,
  type LifecycleStatus,
} from "./referral-partner-row-styles";

// PRD #297 / issue #299 — every LifecycleStatus must have a complete
// row-tint palette (background+border class, label, text class). The map
// is the single keeper of the four palettes on the Referral Partners
// list, so adding a new status without a palette must be impossible to
// ship.
const ALL_STATUSES: ReadonlyArray<LifecycleStatus> = [
  "grey",
  "yellow",
  "green",
  "red",
];

describe("STATUS_ROW_STYLES", () => {
  it.each(ALL_STATUSES)(
    "has a non-empty wrap, label, and text entry for %s",
    (status) => {
      const palette = STATUS_ROW_STYLES[status];
      expect(palette.wrap.trim().length).toBeGreaterThan(0);
      expect(palette.label.trim().length).toBeGreaterThan(0);
      expect(palette.text.trim().length).toBeGreaterThan(0);
    },
  );
});
