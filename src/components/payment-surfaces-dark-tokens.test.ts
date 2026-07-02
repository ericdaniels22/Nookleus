import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// This test lives at src/components/, so the repo root is two levels up.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(resolve(repoRoot, p), "utf8");

// §2.8 money-path reskin (#917): every in-app billing / payment chrome surface
// renders on dark tokens. This is a *reskin only* — no billing logic changes —
// so the guard asserts the OLD light-palette relics are gone. The document
// brand triad (#0F6E56 / #C41E2A) is reserved for customer-facing surfaces
// (§2.8) and must not leak into these in-app modals; hardcoded light greys and
// `bg-white` pills read as bright cards on the dark canvas.
describe("payment surfaces are on dark tokens (#917)", () => {
  it("record-payment modal drops its light hex palette and white pills", () => {
    const src = read("src/components/record-payment.tsx");
    // Legacy light source/status tint boxes.
    for (const hex of [
      "#E1F5EE", "#E6F1FB", "#F1EFE8", "#FAEEDA", "#FCEBEB",
      "#085041", "#0C447C", "#5F5E5A", "#633806", "#791F1F",
    ]) {
      expect(src).not.toContain(hex);
    }
    // Hardcoded greys + the brand-accent submit button (reserved for §2.8).
    for (const hex of ["#666666", "#999999", "#C41E2A", "#A3171F", "#1B2434"]) {
      expect(src).not.toContain(hex);
    }
    // Light-mode pill chrome.
    expect(src).not.toContain("bg-white");
    expect(src).not.toContain("border-gray-200");
    expect(src).not.toContain("border-gray-300");
  });

  it("invoice record-payment modal drops the brand-primary submit button", () => {
    const src = read("src/components/payments/record-payment-modal.tsx");
    // #0F6E56 is the document brand-primary — reserved for §2.8 surfaces.
    expect(src).not.toContain("#0F6E56");
    expect(src).not.toContain("brightness-110");
  });

  it("send modal uses the in-app accent link + §2.5 warning tint, not light yellow", () => {
    const src = read("src/components/send-modal/index.tsx");
    // The settings link is in-app navigation → product accent, not brand triad.
    expect(src).not.toContain("text-[var(--brand-primary)]");
    // The unresolved-fields callout is a §2.5 warning tint, not a light box.
    for (const cls of ["bg-yellow-50", "text-yellow-900", "border-yellow-300"]) {
      expect(src).not.toContain(cls);
    }
  });

  // The app is dark-only (ADR 0027); globals.css keeps a temporary always-on
  // `dark:` bridge. Migrated money-path surfaces drop the dead `text-*-700
  // dark:text-*-300` pairs so only the single dark value remains.
  it.each([
    "src/components/payments/qb-sync-badge.tsx",
    "src/components/payments/online-payment-requests-subsection.tsx",
  ])("%s carries no dead light-mode dark: variants", (path) => {
    expect(read(path)).not.toContain("dark:");
  });
});
