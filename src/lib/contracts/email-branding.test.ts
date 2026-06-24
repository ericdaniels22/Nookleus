import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEmailBranding } from "./email-branding";
import { makeSupabaseFake } from "./__test-utils__/supabase-fake";
import type { ContractEmailSettings } from "./types";

function makeSettings(
  overrides: Partial<ContractEmailSettings> = {},
): ContractEmailSettings {
  return {
    id: "ces-1",
    send_from_email: "contracts@aaa.test",
    send_from_name: "AAA Contracts",
    reply_to_email: null,
    provider: "resend",
    email_account_id: null,
    signing_request_subject_template: "Please sign {{document_title}}",
    signing_request_body_template: "<p>Hi {{customer_name}}</p>",
    signed_confirmation_subject_template: "Signed",
    signed_confirmation_body_template: "<p>Done</p>",
    signed_confirmation_internal_subject_template: "Signed (internal)",
    signed_confirmation_internal_body_template: "<p>Done</p>",
    reminder_subject_template: "Reminder",
    reminder_body_template: "<p>Reminder</p>",
    reminder_day_offsets: [3, 7],
    default_link_expiry_days: 30,
    button_label: "Review & sign",
    button_color: "#1f2937",
    logo_visible: true,
    signing_request_body_template_archived: null,
    updated_at: "2026-06-23T00:00:00Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadEmailBranding (#691)", () => {
  it("resolves the company name and logo path into a branding bundle", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    const fake = makeSupabaseFake();
    fake.seed("company_settings", [
      { organization_id: "org-1", key: "company_name", value: "AAA Disaster Recovery" },
      { organization_id: "org-1", key: "logo_path", value: "logos/aaa.png" },
    ]);

    const branding = await loadEmailBranding(
      fake.client as unknown as SupabaseClient,
      "org-1",
      makeSettings(),
    );

    expect(branding.companyName).toBe("AAA Disaster Recovery");
    expect(branding.logoUrl).toBe(
      "https://proj.supabase.co/storage/v1/object/public/company-assets/logos/aaa.png",
    );
  });

  it("surfaces the style knobs from the contract-email settings row", async () => {
    const fake = makeSupabaseFake();
    fake.seed("company_settings", [
      { organization_id: "org-1", key: "company_name", value: "AAA Disaster Recovery" },
    ]);

    const branding = await loadEmailBranding(
      fake.client as unknown as SupabaseClient,
      "org-1",
      makeSettings({
        button_label: "Open & sign",
        button_color: "#dc2626",
        logo_visible: false,
      }),
    );

    expect(branding.buttonLabel).toBe("Open & sign");
    expect(branding.buttonColor).toBe("#dc2626");
    expect(branding.logoVisible).toBe(false);
  });

  it("yields a null logo url when no logo path is stored", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    const fake = makeSupabaseFake();
    fake.seed("company_settings", [
      { organization_id: "org-1", key: "company_name", value: "AAA Disaster Recovery" },
    ]);

    const branding = await loadEmailBranding(
      fake.client as unknown as SupabaseClient,
      "org-1",
      makeSettings(),
    );

    expect(branding.logoUrl).toBeNull();
  });

  it("reads only the requested organization's branding", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    const fake = makeSupabaseFake();
    fake.seed("company_settings", [
      { organization_id: "org-1", key: "company_name", value: "AAA Disaster Recovery" },
      { organization_id: "org-2", key: "company_name", value: "Other Co" },
    ]);

    const branding = await loadEmailBranding(
      fake.client as unknown as SupabaseClient,
      "org-1",
      makeSettings(),
    );

    expect(branding.companyName).toBe("AAA Disaster Recovery");
  });
});
