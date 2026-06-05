import { describe, expect, it } from "vitest";

import { resolveCoverPageData } from "./cover-page-data";
import type { CompanySettings, Contact, Job } from "./types";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    organization_id: "org-1",
    job_number: "J-0001",
    contact_id: "c-1",
    status: "active",
    urgency: "scheduled",
    damage_type: "water",
    damage_source: null,
    property_address: "123 Main St",
    property_type: "single_family",
    property_sqft: null,
    property_stories: null,
    affected_areas: null,
    insurance_company: null,
    insurance_contact_id: null,
    referral_partner_id: null,
    claim_number: null,
    policy_number: null,
    payer_type: null,
    date_of_loss: null,
    deductible: null,
    estimated_crew_labor_cost: null,
    hoa_name: null,
    hoa_contact_name: null,
    hoa_contact_phone: null,
    hoa_contact_email: null,
    access_notes: null,
    cover_photo_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "c-1",
    organization_id: "org-1",
    full_name: "Jane Customer",
    phone: null,
    email: null,
    role: "homeowner",
    company: null,
    title: null,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeCompanySettings(overrides: Partial<CompanySettings> = {}): CompanySettings {
  return {
    company_name: "AAA Disaster Recovery",
    logo_path: "logos/aaa.png",
    phone: "555-111-2222",
    email: "ops@aaa.example",
    ...overrides,
  };
}

describe("resolveCoverPageData", () => {
  describe("point of contact", () => {
    it("assembles companyName, phone, and email from CompanySettings when all are present", () => {
      const data = resolveCoverPageData(
        makeJob(),
        makeCompanySettings({
          company_name: "AAA Disaster Recovery",
          phone: "555-111-2222",
          email: "ops@aaa.example",
        }),
      );

      expect(data.pointOfContact).toEqual({
        companyName: "AAA Disaster Recovery",
        phone: "555-111-2222",
        email: "ops@aaa.example",
      });
    });

    it("omits the phone line (null) when CompanySettings.phone is empty", () => {
      const data = resolveCoverPageData(
        makeJob(),
        makeCompanySettings({ phone: "", email: "ops@aaa.example" }),
      );

      expect(data.pointOfContact.phone).toBeNull();
      expect(data.pointOfContact.email).toBe("ops@aaa.example");
    });

    it("omits the email line (null) when CompanySettings.email is undefined", () => {
      const data = resolveCoverPageData(
        makeJob(),
        makeCompanySettings({ phone: "555-111-2222", email: undefined }),
      );

      expect(data.pointOfContact.phone).toBe("555-111-2222");
      expect(data.pointOfContact.email).toBeNull();
    });
  });

  describe("logo", () => {
    it("returns an image variant when logo_path is set", () => {
      const data = resolveCoverPageData(
        makeJob(),
        makeCompanySettings({ logo_path: "logos/aaa.png" }),
      );

      expect(data.logo).toEqual({ kind: "image", path: "logos/aaa.png" });
    });

    it("falls back to a styled-text variant using company_name when logo_path is empty", () => {
      const data = resolveCoverPageData(
        makeJob(),
        makeCompanySettings({
          logo_path: "",
          company_name: "AAA Disaster Recovery",
        }),
      );

      expect(data.logo).toEqual({
        kind: "text",
        name: "AAA Disaster Recovery",
      });
    });

    it("falls back to a styled-text variant when logo_path is undefined", () => {
      const data = resolveCoverPageData(
        makeJob(),
        makeCompanySettings({ logo_path: undefined, company_name: "Bob's Roofing" }),
      );

      expect(data.logo).toEqual({ kind: "text", name: "Bob's Roofing" });
    });
  });

  describe("customer + address", () => {
    it("pulls customer name from job.contact.full_name and property_address from the job", () => {
      const data = resolveCoverPageData(
        makeJob({
          property_address: "742 Evergreen Terrace",
          contact: makeContact({ full_name: "Marge Simpson" }),
        }),
        makeCompanySettings(),
      );

      expect(data.customerName).toBe("Marge Simpson");
      expect(data.propertyAddress).toBe("742 Evergreen Terrace");
    });

    it("returns an empty customer name when job.contact is missing", () => {
      const data = resolveCoverPageData(
        makeJob({ contact: undefined, property_address: "1 Lonely Rd" }),
        makeCompanySettings(),
      );

      expect(data.customerName).toBe("");
      expect(data.propertyAddress).toBe("1 Lonely Rd");
    });
  });

  describe("insurance block", () => {
    it("hides the block when both insurance_company and claim_number are null", () => {
      const data = resolveCoverPageData(
        makeJob({ insurance_company: null, claim_number: null }),
        makeCompanySettings(),
      );

      expect(data.insurance.visible).toBe(false);
    });

    it("hides the block when both fields are empty strings", () => {
      const data = resolveCoverPageData(
        makeJob({ insurance_company: "", claim_number: "" }),
        makeCompanySettings(),
      );

      expect(data.insurance.visible).toBe(false);
    });

    it("shows the block with the carrier when only insurance_company is present", () => {
      const data = resolveCoverPageData(
        makeJob({ insurance_company: "Acme Mutual", claim_number: null }),
        makeCompanySettings(),
      );

      expect(data.insurance).toEqual({
        visible: true,
        carrier: "Acme Mutual",
        claimNumber: "",
      });
    });

    it("shows the block with the claim number when only claim_number is present", () => {
      const data = resolveCoverPageData(
        makeJob({ insurance_company: null, claim_number: "CL-42" }),
        makeCompanySettings(),
      );

      expect(data.insurance).toEqual({
        visible: true,
        carrier: "",
        claimNumber: "CL-42",
      });
    });
  });
});
