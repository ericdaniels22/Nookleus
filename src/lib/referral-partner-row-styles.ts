// Row-tint palette for the Referral Partners list page (PRD #297, issue
// #299). Each Lifecycle status maps to a `wrap` (background + border
// classes for the card), a `label` (the uppercase string shown inside the
// row), and a `text` class (the colored text used to render the label).
//
// This map lives in its own pure module so the four palettes have a
// single home and a completeness test can guard against a new status
// shipping without a palette. The shape mirrors the STATUS_STYLES pattern
// from `src/components/contracts/contracts-section.tsx`.

export type LifecycleStatus = "grey" | "yellow" | "green" | "red";

export interface RowStyle {
  /** Background + border classes for the row card. */
  wrap: string;
  /** Uppercase label rendered inside the row. */
  label: string;
  /** Text-color class for the label. */
  text: string;
}

export const STATUS_ROW_STYLES: Record<LifecycleStatus, RowStyle> = {
  grey: {
    wrap: "bg-muted/30 border-border",
    label: "Uncontacted",
    text: "text-muted-foreground",
  },
  yellow: {
    wrap: "bg-[rgba(239,159,39,0.10)] border-[rgba(239,159,39,0.30)]",
    label: "In progress",
    text: "text-[#FAC775]",
  },
  green: {
    wrap: "bg-[rgba(29,158,117,0.10)] border-[rgba(29,158,117,0.30)]",
    label: "Active",
    text: "text-[#5DCAA5]",
  },
  red: {
    wrap: "bg-[rgba(228,75,74,0.08)] border-[rgba(228,75,74,0.30)]",
    label: "Declined",
    text: "text-[#F09595]",
  },
};
