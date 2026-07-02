// Row-tint palette for the Referral Partners surfaces (PRD #297, issue
// #299). Each Lifecycle status maps to a `wrap` (background + border
// classes for the row card), a `label` (the uppercase string shown inside
// the row), a `text` class (the colored text used to render the label),
// and a `chip` class (the pill fill+text shared by the list-page filter
// chips and the Worksheet status chip / flip buttons).
//
// This map lives in its own pure module so the four palettes have a
// single home and a completeness test can guard against a new status
// shipping without a palette. The shape mirrors the STATUS_STYLES pattern
// from `src/components/contracts/contracts-section.tsx`.
//
// Every color is a design token (docs/design-system.md §2.5/§2.6, issue
// #924): the "green"/"Active" family reads as the emerald accent (§2.5 —
// success shares the accent family, there is no separate --success), and
// the yellow/red families use the semantic warning/destructive tokens.
// No hex or rgba literal lives here.

export type LifecycleStatus = "grey" | "yellow" | "green" | "red";

export interface RowStyle {
  /** Background + border classes for the row card. */
  wrap: string;
  /** Uppercase label rendered inside the row. */
  label: string;
  /** Text-color class for the label. */
  text: string;
  /** Pill fill + text — filter chips and the Worksheet status chip/buttons. */
  chip: string;
}

export const STATUS_ROW_STYLES: Record<LifecycleStatus, RowStyle> = {
  grey: {
    wrap: "bg-muted/30 border-border",
    label: "Uncontacted",
    text: "text-muted-foreground",
    chip: "bg-muted text-muted-foreground",
  },
  yellow: {
    wrap: "bg-warning-tint border-warning/30",
    label: "In progress",
    text: "text-warning",
    chip: "bg-warning-tint text-warning",
  },
  green: {
    wrap: "bg-accent-tint border-primary/30",
    label: "Active",
    text: "text-accent-text",
    chip: "bg-accent-tint text-accent-text",
  },
  red: {
    wrap: "bg-destructive/10 border-destructive/30",
    label: "Declined",
    text: "text-destructive",
    chip: "bg-destructive/10 text-destructive",
  },
};
