import { describe, expect, it } from "vitest";

import {
  buildNewTargetPayload,
  isValidNewTarget,
  type NewTargetInput,
} from "./referral-partner-form";

const ORG = "org-1";

function input(overrides: Partial<NewTargetInput> = {}): NewTargetInput {
  return {
    company_name: "Acme Plumbing",
    office_phone: "",
    lead_source: "",
    industry: "",
    notes: "",
    ...overrides,
  };
}

describe("isValidNewTarget", () => {
  it("rejects an empty company_name — the only required field", () => {
    expect(isValidNewTarget(input({ company_name: "" }))).toBe(false);
    expect(isValidNewTarget(input({ company_name: "   " }))).toBe(false);
  });

  it("accepts any input with a non-blank company_name — every other field is optional", () => {
    expect(isValidNewTarget(input())).toBe(true);
    expect(
      isValidNewTarget(input({ company_name: "X", office_phone: "" })),
    ).toBe(true);
  });
});

describe("buildNewTargetPayload", () => {
  it("produces an insert payload pinned to grey status and scoped to the organization", () => {
    const payload = buildNewTargetPayload(input(), ORG);
    expect(payload.status).toBe("grey");
    expect(payload.organization_id).toBe(ORG);
    expect(payload.company_name).toBe("Acme Plumbing");
  });

  it("trims company_name so leading and trailing whitespace doesn't survive into storage", () => {
    const payload = buildNewTargetPayload(
      input({ company_name: "  Acme Plumbing  " }),
      ORG,
    );
    expect(payload.company_name).toBe("Acme Plumbing");
  });

  it("collapses every blank optional field to null — empty strings never reach the column", () => {
    const payload = buildNewTargetPayload(input(), ORG);
    expect(payload.office_phone).toBeNull();
    expect(payload.lead_source).toBeNull();
    expect(payload.industry).toBeNull();
    expect(payload.notes).toBeNull();
  });

  it("trims optional fields and keeps the non-blank ones", () => {
    const payload = buildNewTargetPayload(
      input({
        office_phone: " 555-123-4567 ",
        lead_source: "Google",
        industry: "Plumbing",
        notes: "  found on yelp  ",
      }),
      ORG,
    );
    expect(payload.office_phone).toBe("555-123-4567");
    expect(payload.lead_source).toBe("Google");
    expect(payload.industry).toBe("Plumbing");
    expect(payload.notes).toBe("found on yelp");
  });
});
