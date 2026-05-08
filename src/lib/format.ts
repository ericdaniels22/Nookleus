// Shared currency formatter — used by estimate/invoice builders, totals
// panels, and read-only views. Server-side math elsewhere uses
// Math.round(n * 100) / 100; only display passes through here.

export function formatCurrency(n: number): string {
  return Number(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

// Round to 2 decimals for monetary math. Use this any time you compute
// a total / subtotal / tax amount — never .toFixed (which returns string).
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
