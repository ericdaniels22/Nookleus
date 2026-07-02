import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// This test lives at src/components/, so the repo root is two levels up.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(resolve(repoRoot, p), "utf8");

// §8 step 11 money-path reskin (#929): estimates, the estimate builder, and
// invoices render on dark tokens. Reskin only — zero calculation / billing
// changes — so this guard (the #917 pattern) asserts the OLD light-palette
// relics stay gone. Customer-facing PDF renderers (src/lib/pdf-renderer/*)
// keep the §2.8 light brand palette and are deliberately NOT swept here.
describe("money surfaces are on dark tokens (#929)", () => {
  it("status badge maps carry no light-mode fills", () => {
    // Light shades (-50/-100/-200) are solid fills for white canvases; the
    // dark theme only ever tints (§2.6).
    expect(read("src/lib/estimate-status.ts")).not.toMatch(/-(50|100|200)\b/);
  });

  it.each([
    "src/components/estimate-builder/header-card.tsx",
    "src/components/job-detail/estimates-invoices-section.tsx",
  ])("%s links use the in-app accent, not light-mode blue", (path) => {
    // §5: in-app links are text-accent-text; text-blue-600 is illegible on
    // the dark canvas.
    expect(read(path)).not.toContain("text-blue-600");
  });

  it("trashed-row destructive actions use the token, not raw red", () => {
    expect(read("src/components/job-detail/estimates-invoices-section.tsx")).not.toContain(
      "text-red-600",
    );
  });

  // The app is dark-only (ADR 0027); globals.css keeps a temporary always-on
  // `dark:` bridge. Migrated surfaces drop the dead light-mode pairs so only
  // the single dark value remains.
  it.each([
    "src/components/estimate-builder/save-indicator.tsx",
    "src/components/estimate-builder/statement-editor.tsx",
  ])("%s carries no dead light-mode dark: variants", (path) => {
    expect(read(path)).not.toContain("dark:");
  });

  it("save indicator success reads as emerald-300, not light-mode green", () => {
    const src = read("src/components/estimate-builder/save-indicator.tsx");
    expect(src).not.toContain("text-green-600");
    expect(src).toContain("text-emerald-300");
  });

  it.each([
    "src/app/estimates/[id]/page.tsx",
    "src/app/estimates/[id]/edit/page.tsx",
    "src/app/invoices/[id]/edit/page.tsx",
  ])("%s error back-link uses the product accent, not the §2.8 brand var", (path) => {
    // --brand-primary is the customer-document triad — never in-app (§2.8).
    expect(read(path)).not.toContain("text-[var(--brand-primary)]");
  });

  it("financials invoice list uses semantic text tokens, not raw neutral-*", () => {
    expect(read("src/components/job-detail/financials-invoice-list.tsx")).not.toMatch(
      /text-neutral-\d/,
    );
  });

  it("invoice viewer carries no dead .btn class and sizes its title per §3", () => {
    const src = read("src/components/invoices/invoice-read-only-client.tsx");
    // `.btn` has no definition anywhere in the CSS bundle — actions must use
    // the shared button primitives.
    expect(src).not.toContain('"btn"');
    expect(src).not.toContain("text-2xl");
  });
});
