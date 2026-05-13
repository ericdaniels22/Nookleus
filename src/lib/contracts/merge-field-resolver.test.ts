import { describe, it, expect } from "vitest";
import { makeSupabaseFake } from "./__test-utils__/supabase-fake";
import { resolveMergeFieldValues } from "./merge-field-resolver";
import type { MergeFieldDefinition } from "./merge-field-registry";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("resolveMergeFieldValues", () => {
  it("resolves a maps_to contact.first_name field via the contacts join (tracer)", async () => {
    const fake = makeSupabaseFake();
    fake.seed("jobs", [{ id: "job-1", contact_id: "contact-1" }]);
    fake.seed("contacts", [{ id: "contact-1", first_name: "Alice" }]);

    const registry: MergeFieldDefinition[] = [
      {
        slug: "customer_first_name",
        label: "Customer First Name",
        section: "Caller Information",
        source: { kind: "maps_to", column: "contact.first_name" },
      },
    ];

    const values = await resolveMergeFieldValues(
      fake.client as unknown as SupabaseClient,
      "job-1",
      registry,
    );

    expect(values).toEqual({ customer_first_name: "Alice" });
  });

  it("returns the option label (not raw value) for pill fields with options", async () => {
    const fake = makeSupabaseFake();
    fake.seed("jobs", [
      { id: "job-1", contact_id: null, property_type: "single_family" },
    ]);

    const registry: MergeFieldDefinition[] = [
      {
        slug: "property_type",
        label: "Property Type",
        section: "Property Information",
        source: { kind: "maps_to", column: "job.property_type" },
        options: [
          { value: "single_family", label: "Single Family" },
          { value: "multi_family", label: "Multi Family" },
        ],
      },
    ];

    const values = await resolveMergeFieldValues(
      fake.client as unknown as SupabaseClient,
      "job-1",
      registry,
    );

    expect(values).toEqual({ property_type: "Single Family" });
  });

  it("resolves a job_custom_fields source via field_key lookup", async () => {
    const fake = makeSupabaseFake();
    fake.seed("jobs", [{ id: "job-1", contact_id: null }]);
    fake.seed("job_custom_fields", [
      { job_id: "job-1", field_key: "spouse_name", field_value: "Bob" },
      { job_id: "job-1", field_key: "pet_name", field_value: "Rex" },
    ]);

    const registry: MergeFieldDefinition[] = [
      {
        slug: "spouse_name",
        label: "Spouse Name",
        section: "Caller Information",
        source: { kind: "job_custom_fields", field_key: "spouse_name" },
      },
    ];

    const values = await resolveMergeFieldValues(
      fake.client as unknown as SupabaseClient,
      "job-1",
      registry,
    );

    expect(values).toEqual({ spouse_name: "Bob" });
  });

  it("resolves system date_today as a formatted today's date", async () => {
    const fake = makeSupabaseFake();
    fake.seed("jobs", [{ id: "job-1", contact_id: null }]);

    const registry: MergeFieldDefinition[] = [
      {
        slug: "date_today",
        label: "Today's Date",
        section: "System",
        source: { kind: "system", key: "date_today" },
      },
    ];

    const values = await resolveMergeFieldValues(
      fake.client as unknown as SupabaseClient,
      "job-1",
      registry,
    );

    const expected = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    expect(values).toEqual({ date_today: expected });
  });

  it("resolves system intake_date from jobs.created_at", async () => {
    const fake = makeSupabaseFake();
    fake.seed("jobs", [
      { id: "job-1", contact_id: null, created_at: "2026-01-15T12:00:00Z" },
    ]);

    const registry: MergeFieldDefinition[] = [
      {
        slug: "intake_date",
        label: "Intake Date",
        section: "System",
        source: { kind: "system", key: "intake_date" },
      },
    ];

    const values = await resolveMergeFieldValues(
      fake.client as unknown as SupabaseClient,
      "job-1",
      registry,
    );

    expect(values.intake_date).toMatch(/January 15, 2026/);
  });

  it("resolves adjuster_name and adjuster_phone via the job_adjusters junction (primary)", async () => {
    const fake = makeSupabaseFake();
    fake.seed("jobs", [{ id: "job-1", contact_id: null }]);
    fake.seed("job_adjusters", [
      { job_id: "job-1", contact_id: "adj-1", is_primary: false },
      { job_id: "job-1", contact_id: "adj-2", is_primary: true },
    ]);
    fake.seed("contacts", [
      { id: "adj-1", first_name: "Wrong", last_name: "Adj", phone: "111" },
      { id: "adj-2", first_name: "Jane", last_name: "Smith", phone: "555-9999" },
    ]);

    const registry: MergeFieldDefinition[] = [
      {
        slug: "adjuster_name",
        label: "Adjuster Name",
        section: "System",
        source: { kind: "system", key: "adjuster_name" },
      },
      {
        slug: "adjuster_phone",
        label: "Adjuster Phone",
        section: "System",
        source: { kind: "system", key: "adjuster_phone" },
      },
    ];

    const values = await resolveMergeFieldValues(
      fake.client as unknown as SupabaseClient,
      "job-1",
      registry,
    );

    expect(values).toEqual({
      adjuster_name: "Jane Smith",
      adjuster_phone: "555-9999",
    });
  });

  it("resolves company_* system fields from the company_settings key-value store", async () => {
    const fake = makeSupabaseFake();
    fake.seed("jobs", [{ id: "job-1", contact_id: null }]);
    fake.seed("company_settings", [
      { key: "company_name", value: "AAA Contracting" },
      { key: "phone", value: "555-1234" },
      { key: "email", value: "ops@aaa.com" },
      { key: "address", value: "123 Main St" },
      { key: "license", value: "LIC-9999" },
    ]);

    const registry: MergeFieldDefinition[] = [
      { slug: "company_name", label: "Company Name", section: "System", source: { kind: "system", key: "company_name" } },
      { slug: "company_phone", label: "Company Phone", section: "System", source: { kind: "system", key: "company_phone" } },
      { slug: "company_email", label: "Company Email", section: "System", source: { kind: "system", key: "company_email" } },
      { slug: "company_address", label: "Company Address", section: "System", source: { kind: "system", key: "company_address" } },
      { slug: "company_license", label: "Company License", section: "System", source: { kind: "system", key: "company_license" } },
    ];

    const values = await resolveMergeFieldValues(
      fake.client as unknown as SupabaseClient,
      "job-1",
      registry,
    );

    expect(values).toEqual({
      company_name: "AAA Contracting",
      company_phone: "555-1234",
      company_email: "ops@aaa.com",
      company_address: "123 Main St",
      company_license: "LIC-9999",
    });
  });

  it("returns nulls (not throws) when job/contact/custom-field/settings data is missing", async () => {
    const fake = makeSupabaseFake();
    // No seeds at all — job not found.

    const registry: MergeFieldDefinition[] = [
      { slug: "customer_first_name", label: "Customer First Name", section: "Caller", source: { kind: "maps_to", column: "contact.first_name" } },
      { slug: "property_address", label: "Property Address", section: "Property", source: { kind: "maps_to", column: "job.property_address" } },
      { slug: "spouse_name", label: "Spouse Name", section: "Caller", source: { kind: "job_custom_fields", field_key: "spouse_name" } },
      { slug: "adjuster_name", label: "Adjuster", section: "System", source: { kind: "system", key: "adjuster_name" } },
      { slug: "company_name", label: "Company", section: "System", source: { kind: "system", key: "company_name" } },
    ];

    const values = await resolveMergeFieldValues(
      fake.client as unknown as SupabaseClient,
      "missing-job",
      registry,
    );

    expect(values).toEqual({
      customer_first_name: null,
      property_address: null,
      spouse_name: null,
      adjuster_name: null,
      company_name: null,
    });
  });

  it("resolves system customer_name (full) and customer_address (= property_address) legacy synonyms", async () => {
    const fake = makeSupabaseFake();
    fake.seed("jobs", [
      {
        id: "job-1",
        contact_id: "contact-1",
        property_address: "742 Evergreen Terrace",
      },
    ]);
    fake.seed("contacts", [
      { id: "contact-1", first_name: "Alice", last_name: "Smith" },
    ]);

    const registry: MergeFieldDefinition[] = [
      {
        slug: "customer_name",
        label: "Customer Name",
        section: "System",
        source: { kind: "system", key: "customer_name" },
      },
      {
        slug: "customer_address",
        label: "Customer Address",
        section: "System",
        source: { kind: "system", key: "customer_address" },
      },
    ];

    const values = await resolveMergeFieldValues(
      fake.client as unknown as SupabaseClient,
      "job-1",
      registry,
    );

    expect(values).toEqual({
      customer_name: "Alice Smith",
      customer_address: "742 Evergreen Terrace",
    });
  });

  it("coerces non-string column values (e.g. integer property_sqft) to strings", async () => {
    // Regression: prod sign page crashed with "value.replace is not a function"
    // because jobs.property_sqft is an INTEGER column. The resolver returned
    // the raw number, and resolve-merge-values.ts then called .replace() on
    // it. All downstream consumers assume Record<string, string | null>.
    const fake = makeSupabaseFake();
    fake.seed("jobs", [
      {
        id: "job-1",
        contact_id: null,
        property_sqft: 1500,
        property_stories: 2,
      },
    ]);

    const registry: MergeFieldDefinition[] = [
      {
        slug: "property_sqft",
        label: "Sqft",
        section: "Property",
        source: { kind: "maps_to", column: "job.property_sqft" },
      },
      {
        slug: "property_stories",
        label: "Stories",
        section: "Property",
        source: { kind: "maps_to", column: "job.property_stories" },
      },
    ];

    const values = await resolveMergeFieldValues(
      fake.client as unknown as SupabaseClient,
      "job-1",
      registry,
    );

    expect(values).toEqual({
      property_sqft: "1500",
      property_stories: "2",
    });
  });

  it("title-cases damage_type/property_type values when the field has no options (legacy)", async () => {
    const fake = makeSupabaseFake();
    fake.seed("jobs", [
      {
        id: "job-1",
        contact_id: null,
        damage_type: "water_damage",
        property_type: "single_family",
      },
    ]);

    const registry: MergeFieldDefinition[] = [
      {
        slug: "damage_type",
        label: "Damage Type",
        section: "Job",
        source: { kind: "maps_to", column: "job.damage_type" },
      },
      {
        slug: "property_type",
        label: "Property Type",
        section: "Job",
        source: { kind: "maps_to", column: "job.property_type" },
      },
    ];

    const values = await resolveMergeFieldValues(
      fake.client as unknown as SupabaseClient,
      "job-1",
      registry,
    );

    expect(values).toEqual({
      damage_type: "Water Damage",
      property_type: "Single Family",
    });
  });
});
