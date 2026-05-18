import { describe, expect, it } from "vitest";

import type { QbMappingRow } from "@/lib/qb/types";

import {
  buildCustomerPayload,
  buildSubCustomerPayload,
  type ContactRow,
  type JobRow,
} from "./customers";

// The QuickBooks customer sync moved off the legacy split name (issue #114,
// slice 5): the payload `DisplayName` comes straight from `contacts.full_name`,
// and `GivenName` / `FamilyName` are derived with the shared last-space split.

function makeContact(overrides: Partial<ContactRow> = {}): ContactRow {
  return {
    id: "c1",
    full_name: "John Doe",
    phone: null,
    email: null,
    notes: null,
    qb_customer_id: null,
    ...overrides,
  };
}

function makeJob(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "j1",
    contact_id: "c1",
    job_number: "JOB-001",
    damage_type: "water",
    property_address: "12 Maple St",
    qb_subcustomer_id: null,
    ...overrides,
  };
}

describe("buildCustomerPayload", () => {
  it("sets DisplayName from full_name", () => {
    const payload = buildCustomerPayload(makeContact({ full_name: "Mary Jane Watson" }));
    expect(payload.DisplayName).toBe("Mary Jane Watson");
  });

  it("derives GivenName and FamilyName via the last-space split", () => {
    const payload = buildCustomerPayload(makeContact({ full_name: "Mary Jane Watson" }));
    expect(payload.GivenName).toBe("Mary Jane");
    expect(payload.FamilyName).toBe("Watson");
  });

  it("leaves FamilyName undefined for a single-token name", () => {
    const payload = buildCustomerPayload(makeContact({ full_name: "Cher" }));
    expect(payload.GivenName).toBe("Cher");
    expect(payload.FamilyName).toBeUndefined();
  });

  it("falls back to (no name) when full_name is empty", () => {
    const payload = buildCustomerPayload(makeContact({ full_name: "" }));
    expect(payload.DisplayName).toBe("(no name)");
    expect(payload.GivenName).toBeUndefined();
    expect(payload.FamilyName).toBeUndefined();
  });

  it("trims surrounding whitespace from DisplayName", () => {
    const payload = buildCustomerPayload(makeContact({ full_name: "  John Doe  " }));
    expect(payload.DisplayName).toBe("John Doe");
  });

  it("carries phone, email and notes when present", () => {
    const payload = buildCustomerPayload(
      makeContact({ phone: "555-1234", email: "a@b.com", notes: "VIP" }),
    );
    expect(payload.PrimaryPhone).toEqual({ FreeFormNumber: "555-1234" });
    expect(payload.PrimaryEmailAddr).toEqual({ Address: "a@b.com" });
    expect(payload.Notes).toBe("VIP");
  });

  it("omits phone, email and notes when absent", () => {
    const payload = buildCustomerPayload(makeContact());
    expect(payload.PrimaryPhone).toBeUndefined();
    expect(payload.PrimaryEmailAddr).toBeUndefined();
    expect(payload.Notes).toBeUndefined();
  });
});

describe("buildSubCustomerPayload", () => {
  it("uses the family name from full_name as the sub-customer prefix", () => {
    const payload = buildSubCustomerPayload(
      makeJob({ job_number: "JOB-007", damage_type: "fire" }),
      makeContact({ full_name: "Mary Jane Watson" }),
      "qb-parent-1",
      null,
    );
    expect(payload.DisplayName).toBe("Watson: JOB-007 - Fire Work");
  });

  it("falls back to the given name when full_name is a single token", () => {
    const payload = buildSubCustomerPayload(
      makeJob({ job_number: "JOB-007", damage_type: "fire" }),
      makeContact({ full_name: "Cher" }),
      "qb-parent-1",
      null,
    );
    expect(payload.DisplayName).toBe("Cher: JOB-007 - Fire Work");
  });

  it("falls back to Customer when full_name is empty", () => {
    const payload = buildSubCustomerPayload(
      makeJob({ job_number: "JOB-007", damage_type: "fire" }),
      makeContact({ full_name: "" }),
      "qb-parent-1",
      null,
    );
    expect(payload.DisplayName).toBe("Customer: JOB-007 - Fire Work");
  });

  it("sets ParentRef, BillAddr and ClassRef when supplied", () => {
    const classMapping: QbMappingRow = {
      id: "m1",
      type: "damage_type",
      platform_value: "fire",
      qb_entity_id: "class-9",
      qb_entity_name: "Fire Restoration",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    };
    const payload = buildSubCustomerPayload(
      makeJob(),
      makeContact({ full_name: "Mary Jane Watson" }),
      "qb-parent-1",
      classMapping,
    );
    expect(payload.ParentRef).toEqual({ value: "qb-parent-1" });
    expect(payload.BillAddr).toEqual({ Line1: "12 Maple St" });
    expect(payload.ClassRef).toEqual({ value: "class-9", name: "Fire Restoration" });
  });
});
