import { describe, expect, it } from "vitest";

import {
  distinctIndustries,
  filterReferralPartners,
  type FilterableReferralPartner,
} from "./referral-partner-filter";

const partner = (
  overrides: Partial<FilterableReferralPartner> = {},
): FilterableReferralPartner => ({
  id: "p",
  company_name: "Acme Plumbing",
  status: "grey",
  industry: "Plumbing",
  ...overrides,
});

describe("filterReferralPartners", () => {
  it("returns every partner when no filters are supplied", () => {
    const partners = [
      partner({ id: "a" }),
      partner({ id: "b", status: "green" }),
      partner({ id: "c", status: "red", industry: null }),
    ];
    expect(filterReferralPartners(partners, {})).toEqual(partners);
  });

  it("narrows to a single industry when the dropdown selects one", () => {
    const partners = [
      partner({ id: "a", industry: "Plumbing" }),
      partner({ id: "b", industry: "Restoration" }),
      partner({ id: "c", industry: "Plumbing" }),
      partner({ id: "d", industry: null }),
    ];
    const result = filterReferralPartners(partners, { industry: "Plumbing" });
    expect(result.map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("matches the search query as a case-insensitive substring of company_name", () => {
    const partners = [
      partner({ id: "a", company_name: "Acme Plumbing" }),
      partner({ id: "b", company_name: "Beachside Restoration" }),
      partner({ id: "c", company_name: "ACE Plumbing & Heating" }),
    ];
    const result = filterReferralPartners(partners, { query: "plumb" });
    expect(result.map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("treats an empty or whitespace-only query as a no-op", () => {
    const partners = [
      partner({ id: "a" }),
      partner({ id: "b", status: "green" }),
    ];
    expect(filterReferralPartners(partners, { query: "" })).toEqual(partners);
    expect(filterReferralPartners(partners, { query: "   " })).toEqual(partners);
  });

  it("keeps only the Lifecycle statuses the chip filter has enabled", () => {
    const partners = [
      partner({ id: "g", status: "grey" }),
      partner({ id: "y", status: "yellow" }),
      partner({ id: "gr", status: "green" }),
      partner({ id: "r", status: "red" }),
    ];
    const result = filterReferralPartners(partners, { status: ["yellow", "green"] });
    expect(result.map((p) => p.id)).toEqual(["y", "gr"]);
  });

  it("composes status, industry, and query with AND semantics", () => {
    const partners = [
      partner({ id: "a", status: "grey",   industry: "Plumbing",    company_name: "Acme Plumbing" }),
      partner({ id: "b", status: "green",  industry: "Plumbing",    company_name: "Acme Plumbing East" }),
      partner({ id: "c", status: "grey",   industry: "Restoration", company_name: "Acme Restoration" }),
      partner({ id: "d", status: "grey",   industry: "Plumbing",    company_name: "Beta Plumbing" }),
    ];
    const result = filterReferralPartners(partners, {
      status: ["grey"],
      industry: "Plumbing",
      query: "acme",
    });
    expect(result.map((p) => p.id)).toEqual(["a"]);
  });
});

describe("distinctIndustries", () => {
  it("returns the unique, non-null industries sorted alphabetically", () => {
    const partners = [
      partner({ id: "a", industry: "Plumbing" }),
      partner({ id: "b", industry: "Restoration" }),
      partner({ id: "c", industry: "Plumbing" }),
      partner({ id: "d", industry: null }),
      partner({ id: "e", industry: "Adjusting" }),
    ];
    expect(distinctIndustries(partners)).toEqual(["Adjusting", "Plumbing", "Restoration"]);
  });
});
