import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));
// The email provider (network), the merge-field engine (its own deep
// subsystem), and the token signer are stubbed at their module boundary.
// Everything the branded-card slice (#692) threads into the resend route —
// sanitize → loadEmailBranding → renderContractEmailFrame — runs for real.
vi.mock("@/lib/contracts/email", () => ({ sendContractEmail: vi.fn() }));
vi.mock("@/lib/contracts/email-merge-fields", () => ({
  resolveEmailTemplate: vi.fn(),
}));
vi.mock("@/lib/contracts/tokens", () => ({ generateSigningToken: vi.fn() }));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { sendContractEmail } from "@/lib/contracts/email";
import { resolveEmailTemplate } from "@/lib/contracts/email-merge-fields";
import { generateSigningToken } from "@/lib/contracts/tokens";
import {
  makeSupabaseFake,
  makeAuthedFake,
  makeUnauthedFake,
  type SupabaseFake,
} from "@/lib/contracts/__test-utils__/supabase-fake";

function makeRequest(): Request {
  return new Request("http://test/api/contracts/c-1/resend", { method: "POST" });
}

function resendRequest(body: Record<string, unknown> = {}): Request {
  return new Request("http://test/api/contracts/c-1/resend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

// Service fake seeded with a contract-email-settings row that has no
// send-from configured, so a caller past the gate gets a deterministic 400.
function seededService() {
  const service = makeSupabaseFake();
  service.seed("contract_email_settings", [
    { id: "s-1", send_from_email: null, send_from_name: null },
  ]);
  return service;
}

// #106 — resending a signing request is a contracts mutation, gated on
// `edit_jobs`. A holder / admin passes the gate; the handler then returns
// 400 (no send-from configured) — proof the wrapper let it run.
describe("POST /api/contracts/[id]/resend — permission gate (#106)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServiceClient).mockReturnValue(
      seededService().client as never,
    );
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeUnauthedFake() as never,
    );
    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller has no job permissions", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member", grants: [] }) as never,
    );
    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(403);
  });

  it("a member holding edit_jobs passes the gate", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member", grants: ["edit_jobs"] }) as never,
    );
    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(400);
  });

  it("an admin passes the gate", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(400);
  });
});

// A service fake seeded so the resend handler runs all the way to the send:
// email settings with a send-from + branding knobs, a resendable contract,
// a primary signer, and the org's company name for loadEmailBranding.
function seedHappyPath(): SupabaseFake {
  const service = makeSupabaseFake();
  service.seed("contract_email_settings", [
    {
      id: "s-1",
      send_from_email: "contracts@aaa.test",
      send_from_name: "AAA Contracts",
      provider: "resend",
      signing_request_subject_template: "Please sign {{document_title}}",
      signing_request_body_template: "<p>placeholder</p>",
      default_link_expiry_days: 14,
      button_label: "Review & sign",
      button_color: "#1f2937",
      logo_visible: true,
    },
  ]);
  service.seed("contracts", [
    {
      id: "c-1",
      organization_id: "org-1",
      job_id: "job-1",
      title: "Roof Replacement Agreement",
      status: "sent",
      link_token: "old-tok",
    },
  ]);
  service.seed("contract_signers", [
    {
      id: "signer-1",
      organization_id: "org-1",
      contract_id: "c-1",
      signer_order: 1,
      email: "pat@owner.test",
      signed_at: null,
    },
  ]);
  service.seed("company_settings", [
    { organization_id: "org-1", key: "company_name", value: "AAA Disaster Recovery" },
  ]);
  return service;
}

// #692 — resend is a re-send of the *initial* signing request, so it carries
// the same branded card and a fresh signing link on the action button. The
// merge engine, token signer, and email provider are stubbed; the
// sanitize → loadEmailBranding → renderContractEmailFrame seam runs for real.
describe("POST /api/contracts/[id]/resend — branded card (#692)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.test");
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    vi.mocked(generateSigningToken).mockReturnValue("resend-tok-1");
    vi.mocked(resolveEmailTemplate).mockResolvedValue({
      subject: "Please sign Roof Replacement Agreement",
      html: "<p>Please review and sign at your convenience.</p>",
      unresolvedFields: [],
    });
    vi.mocked(sendContractEmail).mockResolvedValue({
      messageId: "msg-resend-1",
      provider: "resend",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("re-sends the signing request as the branded card with a fresh signing link on the action button", async () => {
    vi.mocked(createServiceClient).mockReturnValue(seedHappyPath().client as never);

    const res = await POST(resendRequest(), paramsFor("c-1"));
    expect(res.status).toBe(200);

    const html = vi.mocked(sendContractEmail).mock.calls[0][2].html;
    // the app-owned card shell …
    expect(html).toContain('role="presentation"');
    // … the contractor's message embedded inside …
    expect(html).toContain("Please review and sign at your convenience.");
    // … and the *fresh* token on the action button (not the contract's old one).
    expect(html).toContain('href="https://app.test/sign/resend-tok-1"');
    // it reads as the initial signing request, not a reminder.
    expect(html).toContain("sent you a document to review and sign");
    expect(html).not.toContain("is waiting for your signature");
  });

  it("sanitizes the contractor's message but leaves the app-owned frame intact", async () => {
    vi.mocked(resolveEmailTemplate).mockResolvedValue({
      subject: "Please sign",
      html: '<p>Safe resend text.</p><script>alert("xss")</script>',
      unresolvedFields: [],
    });
    vi.mocked(createServiceClient).mockReturnValue(seedHappyPath().client as never);

    const res = await POST(resendRequest(), paramsFor("c-1"));
    expect(res.status).toBe(200);

    const html = vi.mocked(sendContractEmail).mock.calls[0][2].html;
    expect(html).not.toContain("<script");
    expect(html).not.toContain('alert("xss")');
    expect(html).toContain("Safe resend text.");
    // the frame is assembled around the sanitized message, never through it.
    expect(html).toContain('role="presentation"');
  });
});
