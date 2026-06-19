export type ProfitPalette = {
  /** the headline number's text colour */
  text: string;
  /** the card's background tint */
  background: string;
  /** the card's border tint */
  border: string;
  /** the caption's text colour — a lighter shade of the figure colour */
  caption: string;
};

export type ProfitFigure = {
  label: "Profit";
  palette: ProfitPalette;
  /** sub-label under the figure; omitted when there's nothing to say */
  caption?: string;
};

// Green keeps the figure's existing money-palette tint verbatim so a positive
// Profit is visually unchanged; red is the same #F09595 named in the palette,
// derived to a matching low-alpha background/border for the loss case.
const GREEN: ProfitPalette = {
  text: "#5DCAA5",
  background: "rgba(29, 158, 117, 0.12)",
  border: "rgba(29, 158, 117, 0.35)",
  caption: "#9FE1CB",
};

const RED: ProfitPalette = {
  text: "#F09595",
  background: "rgba(240, 149, 149, 0.12)",
  border: "rgba(240, 149, 149, 0.35)",
  caption: "#F09595",
};

// `gross_margin`/`margin_pct` keep the existing summary field names; the value
// is the Job's Profit (Collected − Expenses − Crew labor) — renaming the data
// shape is a separate concern (see #714's view-model deriver).
export function profitFigure(summary: {
  gross_margin: number;
  margin_pct: number | null;
  in_progress: boolean;
}): ProfitFigure {
  const palette = summary.gross_margin >= 0 ? GREEN : RED;
  const caption = summary.in_progress
    ? "(in progress)"
    : summary.margin_pct !== null
      ? `${summary.margin_pct.toFixed(1)}% profit`
      : undefined;
  return { label: "Profit", palette, caption };
}
