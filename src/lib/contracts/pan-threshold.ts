export const PAN_THRESHOLD_PX = 4;

export function isPanThresholdExceeded(dx: number, dy: number, threshold = PAN_THRESHOLD_PX): boolean {
  return Math.hypot(dx, dy) >= threshold;
}
