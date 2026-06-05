import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// This test lives at src/app/invoices/, so the repo root is three levels up.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const at = (p: string) => resolve(repoRoot, p);

describe("invoice creation surfaces are retired (#386)", () => {
  it("removes the direct 'new invoice' page route", () => {
    // There is no UI entry point to author an invoice without an estimate.
    expect(existsSync(at("src/app/jobs/[id]/invoices/new/page.tsx"))).toBe(false);
  });

  it("removes the standalone cross-job invoices list page", () => {
    // Cross-job "who owes us" is covered by the accounting dashboard's AR aging.
    expect(existsSync(at("src/app/invoices/page.tsx"))).toBe(false);
    expect(existsSync(at("src/components/invoices/invoice-list-client.tsx"))).toBe(false);
  });

  it("keeps invoice view + edit pages (reached through the Job)", () => {
    expect(existsSync(at("src/app/invoices/[id]/page.tsx"))).toBe(true);
    expect(existsSync(at("src/app/invoices/[id]/edit/page.tsx"))).toBe(true);
  });

  it("keeps estimate conversion as the surviving creation path", () => {
    expect(existsSync(at("src/app/api/estimates/[id]/convert/route.ts"))).toBe(true);
  });
});
