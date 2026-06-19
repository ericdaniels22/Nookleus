export function fmtCurrency(n: number): string {
  // Show cents when the value has a non-zero fractional part (so small test
  // invoices don't collapse to $0); otherwise keep the clean integer display.
  // Full precision always — seven-figure amounts render in full, never abbreviated.
  const hasCents = Math.round(n * 100) % 100 !== 0;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  });
}
