import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// This test lives at src/components/estimate-builder/, so the repo root is
// three levels up.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const at = (p: string) => resolve(repoRoot, p);

// #571 moved the template choice up front: the New Estimate modal on the Job
// page creates + applies in one action, so the create-and-redirect page and
// the in-builder "Start from a template?" banner are retired.
describe("estimate create surfaces are retired (#571)", () => {
  it("removes the create-and-redirect page route", () => {
    expect(existsSync(at("src/app/jobs/[id]/estimates/new/page.tsx"))).toBe(false);
  });

  it("removes the in-builder template banner", () => {
    expect(
      existsSync(at("src/components/template-applicator/template-banner.tsx")),
    ).toBe(false);
  });

  it("drops the per-document template-applied localStorage flag from the builder", () => {
    const builder = readFileSync(
      at("src/components/estimate-builder/estimate-builder.tsx"),
      "utf8",
    );
    expect(builder).not.toContain("template-applied");
    expect(builder).not.toContain("TemplateBanner");
  });

  it("keeps the modal-backed create path", () => {
    expect(
      existsSync(at("src/components/job-detail/new-estimate-modal.tsx")),
    ).toBe(true);
    expect(
      existsSync(at("src/app/api/estimates/create-with-template/route.ts")),
    ).toBe(true);
  });
});
