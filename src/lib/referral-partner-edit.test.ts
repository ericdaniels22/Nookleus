import { describe, expect, it } from "vitest";

import { buildEditPayload } from "./referral-partner-edit";

describe("buildEditPayload", () => {
  it("returns ok with only the whitelisted editable Worksheet columns", () => {
    const result = buildEditPayload({
      company_name: "Acme Plumbing",
      industry: "Plumbing",
      lead_source: "Google",
      operation_size: "10–25",
      office_phone: "+15551230001",
      office_email: "ops@acme.test",
      website: "acme.test",
      address: "100 Main St",
      referral_fee_terms: "10% per closed job",
      notes: "left voicemail",
      status: "yellow",
    });
    expect(result).toEqual({
      ok: true,
      payload: {
        company_name: "Acme Plumbing",
        industry: "Plumbing",
        lead_source: "Google",
        operation_size: "10–25",
        office_phone: "+15551230001",
        office_email: "ops@acme.test",
        website: "acme.test",
        address: "100 Main St",
        referral_fee_terms: "10% per closed job",
        notes: "left voicemail",
        status: "yellow",
      },
    });
  });

  it("drops keys the client must not be able to write — id, organization_id, deleted_at, denormalized columns", () => {
    const result = buildEditPayload({
      id: "p-evil",
      organization_id: "org-other",
      deleted_at: "2026-01-01",
      last_called_at: "2026-01-01",
      last_call_outcome: "spoke",
      next_follow_up_at: "2027-01-01",
      primary_contact_id: "c-evil",
      owner_contact_id: "c-evil",
      company_name: "Acme",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual({ company_name: "Acme" });
  });

  it("collapses blank optional text fields to null so empty strings don't reach the column", () => {
    const result = buildEditPayload({
      industry: "  ",
      notes: "",
      office_phone: "  +15551230001  ",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual({
      industry: null,
      notes: null,
      office_phone: "+15551230001",
    });
  });

  it("rejects a blank company_name — the only required column on referral_partners", () => {
    const result = buildEditPayload({ company_name: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/company_name/i);
  });

  it("rejects an unknown Lifecycle status value", () => {
    const result = buildEditPayload({ status: "purple" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/status/i);
  });

  it.each(["grey", "yellow", "green", "red"] as const)(
    "accepts Lifecycle status %s",
    (status) => {
      const result = buildEditPayload({ status });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.status).toBe(status);
    },
  );

  it("rejects an empty body — no editable fields means nothing to update", () => {
    const result = buildEditPayload({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no.*fields/i);
  });
});
