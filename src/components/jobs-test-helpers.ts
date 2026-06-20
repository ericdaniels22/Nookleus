// Shared test helpers for the Jobs row/card component suites.

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
