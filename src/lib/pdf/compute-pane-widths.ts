export interface ComputePaneWidthsOptions {
  /** Fraction of the container the rail aims for. Default ~a quarter. */
  railRatio?: number;
  /** Gap between the rail and the page pane, subtracted from the page width. */
  gutter?: number;
  /** Lower bound so the rail stays a usable thumbnail column. */
  minRailWidth?: number;
  /** Upper bound so the rail stays slim on very wide viewports. */
  maxRailWidth?: number;
  /** Below this container width the rail collapses to zero (phone / narrow). */
  collapseBelow?: number;
  /** Force the rail closed regardless of width (manual toggle / single page). */
  collapsed?: boolean;
}

export function computePaneWidths(
  containerWidth: number,
  options: ComputePaneWidthsOptions = {},
) {
  const {
    railRatio = 0.25,
    gutter = 16,
    minRailWidth = 180,
    maxRailWidth = 280,
    collapseBelow = 640,
    collapsed = false,
  } = options;

  if (containerWidth <= 0) {
    return { railWidth: 0, pageWidth: 0 };
  }

  if (collapsed || containerWidth < collapseBelow) {
    // A measured container always renders at least 1px: below the gutter width
    // the raw subtraction goes negative, which react-pdf turns into a negative
    // render scale. (The unmeasured containerWidth <= 0 case returned {0,0} above.)
    return { railWidth: 0, pageWidth: Math.max(1, containerWidth - gutter) };
  }

  const railWidth = Math.min(
    maxRailWidth,
    Math.max(minRailWidth, containerWidth * railRatio),
  );
  const pageWidth = Math.max(1, containerWidth - railWidth - gutter);
  return { railWidth, pageWidth };
}
