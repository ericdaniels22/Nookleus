import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// The email provider (network) and the merge-field engine (its own deep
// subsystem) are stubbed at their module boundary. Everything the branded-card
// slice (#692) threads into the reminders library — sanitize → loadEmailBranding
// → renderContractEmailFrame — runs for real so the seam itself is under test.
vi.mock("./email", () => ({ sendContractEmail: vi.fn() }));
vi.mock("./email-merge-fields", () => ({ resolveEmailTemplate: vi.fn() }));

import { sendContractReminder } from "./reminders";
import { sendContractEmail } from "./email";
import { resolveEmailTemplate } from "./email-merge-fields";
import { makeSupabaseFake } from "./__test-utils__/supabase-fake";
import type { Contract, ContractSigner, ContractEmailSettings } from "./types";

function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: "contract-1",
    organization_id: "org-1",
    job_id: "job-1",
    title: "Roof Replacement Agreement",
    status: "sent",
    link_token: "tok-123",
    ...overrides,
  } as Contract;
}

function makeSigner(overrides: Partial<ContractSigner> = {}): ContractSigner {
  return {
    id: "signer-1",
    organization_id: "org-1",
    contract_id: "contract-1",
    signer_order: 1,
    role_label: "Signer",
    name: "Pat Owner",
    email: "pat@owner.test",
    signed_at: null,
    ...overrides,
  } as ContractSigner;
}

function makeSettings(
  overrides: Partial<ContractEmailSettings> = {},
): ContractEmailSettings {
  return {
    id: "ces-1",
    send_from_email: "contracts@aaa.test",
    send_from_name: "AAA Contracts",
    provider: "resend",
    reminder_subject_template: "Reminder: please sign {{document_title}}",
    reminder_body_template: "<p>Just a quick reminder to sign.</p>",
    reminder_day_offsets: [1, 3],
    button_label: "Review & sign",
    button_color: "#1f2937",
    logo_visible: true,
    ...overrides,
  } as ContractEmailSettings;
}

// A service fake seeded with the org's company name, so loadEmailBranding can
// resolve real branding into the card.
function seededService() {
  const fake = makeSupabaseFake();
  fake.seed("company_settings", [
    { organization_id: "org-1", key: "company_name", value: "AAA Disaster Recovery" },
  ]);
  return fake;
}

describe("sendContractReminder — branded card (#692)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
    vi.mocked(resolveEmailTemplate).mockResolvedValue({
      subject: "Reminder: please sign Roof Replacement Agreement",
      html: "<p>Just a quick reminder to sign.</p>",
      unresolvedFields: [],
    });
    vi.mocked(sendContractEmail).mockResolvedValue({
      messageId: "msg-r1",
      provider: "resend",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("wraps the reminder message in the branded card, with the signing link on the action button", async () => {
    const fake = seededService();
    await sendContractReminder(
      fake.client as unknown as SupabaseClient,
      makeContract({ link_token: "tok-123" }),
      [makeSigner()],
      makeSettings(),
    );

    const html = vi.mocked(sendContractEmail).mock.calls[0][2].html;
    // The app-owned card shell …
    expect(html).toContain('role="presentation"');
    // … the contractor's reminder message embedded inside …
    expect(html).toContain("Just a quick reminder to sign.");
    // … and the signing link injected into the action button (not the body).
    expect(html).toContain('href="https://app.test/sign/tok-123"');
  });

  it("sanitizes the contractor's message but leaves the app-owned frame intact", async () => {
    vi.mocked(resolveEmailTemplate).mockResolvedValue({
      subject: "Reminder",
      html: '<p>Safe reminder text.</p><script>alert("xss")</script>',
      unresolvedFields: [],
    });
    const fake = seededService();
    await sendContractReminder(
      fake.client as unknown as SupabaseClient,
      makeContract(),
      [makeSigner()],
      makeSettings(),
    );

    const html = vi.mocked(sendContractEmail).mock.calls[0][2].html;
    // the message is sanitized …
    expect(html).not.toContain("<script");
    expect(html).not.toContain('alert("xss")');
    expect(html).toContain("Safe reminder text.");
    // … but the frame survives — it is assembled around the sanitized message,
    // never run through the sanitizer (whose ALLOWED_TAGS has no table/tr/td).
    expect(html).toContain('role="presentation"');
  });

  it("renders as the reminder kind — reminder headline, not the initial-send copy", async () => {
    const fake = seededService();
    await sendContractReminder(
      fake.client as unknown as SupabaseClient,
      makeContract(),
      [makeSigner()],
      makeSettings(),
    );

    const html = vi.mocked(sendContractEmail).mock.calls[0][2].html;
    expect(html).toContain("is waiting for your signature");
    expect(html).not.toContain("sent you a document to review and sign");
    expect(html).toContain("🔔");
  });

  it("carries the contractor's branding knobs — same button color/label as the initial email", async () => {
    const fake = seededService();
    await sendContractReminder(
      fake.client as unknown as SupabaseClient,
      makeContract(),
      [makeSigner()],
      makeSettings({ button_label: "Sign the roof contract", button_color: "#7c3aed" }),
    );

    const html = vi.mocked(sendContractEmail).mock.calls[0][2].html;
    expect(html).toContain("#7c3aed");
    expect(html).toContain("Sign the roof contract");
    // company wordmark from the resolved branding leads the card
    expect(html).toContain("AAA Disaster Recovery");
  });

  it("sends to the active (unsigned) signer in a multi-signer contract", async () => {
    const fake = seededService();
    await sendContractReminder(
      fake.client as unknown as SupabaseClient,
      makeContract(),
      [
        makeSigner({ id: "s1", signer_order: 1, email: "first@owner.test", signed_at: "2026-06-20T00:00:00Z" }),
        makeSigner({ id: "s2", signer_order: 2, email: "second@owner.test", signed_at: null }),
      ],
      makeSettings(),
    );

    expect(vi.mocked(sendContractEmail).mock.calls[0][2].to).toBe("second@owner.test");
  });
});
