export const ACCOUNT_COLOR_PALETTE = [
  "#0F6E56", // Nookleus brand green
  "#2563EB", // blue-600
  "#D97706", // amber-600
  "#7C3AED", // violet-600
  "#E11D48", // rose-600
] as const;

export const ACCOUNT_COLOR_FALLBACK = "#6B7280"; // gray-500

const PALETTE = ACCOUNT_COLOR_PALETTE;
const FALLBACK = ACCOUNT_COLOR_FALLBACK;

export function assignAccountColor(
  _orgId: string | null,
  existingColors: readonly string[],
  override?: string | null,
): string {
  if (override != null && override.length > 0) return override;
  const used = new Set(existingColors);
  for (const color of PALETTE) {
    if (!used.has(color)) return color;
  }
  return FALLBACK;
}
