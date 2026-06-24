import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));
// The email provider (network) and the merge-field engine (a deep subsystem
// with its own tests) are the two collaborators the send route leans on that
// we stub at their module boundary. Everything the branded-card slice (#691)
// adds — sanitize → loadEmailBranding → renderContractEmailFrame — runs for
// real so the seam itself is under test.
vi.mock("@/lib/contracts/email", () => ({ sendContractEmail: vi.fn() }));
vi.mock("@/lib/contracts/email-merge-fields", () => ({
  resolveEmailTemplate: vi.fn(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { sendContractEmail } from "@/lib/contracts/email";
import { resolveEmailTemplate } from "@/lib/contracts/email-merge-fields";
import {
  makeSupabaseFake,
  makeAuthedFake,
  makeUnauthedFake,
  type SupabaseFake,
} from "@/lib/contracts/__test-utils__/supabase-fake";

function makeRequest(): Request {
  return new Request("http://test/api/contracts/send", { method: "POST" });
}

const routeCtx = { params: Promise.resolve({}) };

// #106 — sending a contract is a job-edit-class mutation, gated on
// `edit_jobs`. A holder / admin passes the gate; with an empty body the
// handler then returns 400 — proof the wrapper let it run.
describe("POST /api/contracts/send — permission gate (#106)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServiceClient).mockReturnValue(
      makeSupabaseFake().client as never,
    );
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeUnauthedFake() as never,
    );
    const res = await POST(makeRequest(), routeCtx);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller has no job permissions", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member", grants: [] }) as never,
    );
    const res = await POST(makeRequest(), routeCtx);
    expect(res.status).toBe(403);
  });

  it("returns 403 when the caller holds only view_jobs", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member", grants: ["view_jobs"] }) as never,
    );
    const res = await POST(makeRequest(), routeCtx);
    expect(res.status).toBe(403);
  });

  it("a member holding edit_jobs passes the gate", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member", grants: ["edit_jobs"] }) as never,
    );
    const res = await POST(makeRequest(), routeCtx);
    expect(res.status).toBe(400);
  });

  it("an admin passes the gate", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const res = await POST(makeRequest(), routeCtx);
    expect(res.status).toBe(400);
  });
});

// --- Branded-card send path (#691) -----------------------------------------
//
// The initial signing-request email is now an app-owned branded card: the
// route resolves merge fields, sanitizes the contractor's message, then
// assembles the card AROUND it (the {{signing_link}} lives in the card's
// action button, no longer required in the body). These tests drive the seam
// end-to-end with the email provider + merge engine stubbed.

// A request carrying a real JSON body (the gate tests above post an empty one).
function sendRequest(body: Record<string, unknown>): Request {
  return new Request("http://test/api/contracts/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// A message-only body — no {{signing_link}} token. Before #691 this was a 400.
const MESSAGE_ONLY_BODY = {
  jobId: "job-1",
  templateId: "tpl-1",
  signers: [{ name: "Pat Owner", email: "pat@owner.test" }],
  emailSubject: "Please sign your agreement",
  emailBody: "<p>Hi Pat, please review and sign at your convenience.</p>",
};

function seedHappyPath(): SupabaseFake {
  const fake = makeSupabaseFake();
  fake.seed("contract_email_settings", [
    {
      id: "ce-1",
      organization_id: "org-1",
      provider: "resend",
      send_from_email: "contracts@aaa.test",
      send_from_name: "AAA Contracts",
      default_link_expiry_days: 7,
      reminder_day_offsets: [],
      signing_request_subject_template: "Please sign {{document_title}}",
      signing_request_body_template:
        "<p>Hi {{customer_name}}, please review and sign.</p>",
      button_label: "Review & sign",
      button_color: "#1f2937",
      logo_visible: true,
    },
  ]);
  fake.seed("contract_templates", [
    {
      id: "tpl-1",
      organization_id: "org-1",
      name: "Roof Replacement Agreement",
      pdf_storage_path: "templates/roof.pdf",
      version: 1,
      is_active: true,
      signer_role_label: null,
      overlay_fields: [],
    },
  ]);
  fake.seed("jobs", [{ id: "job-1", organization_id: "org-1" }]);
  fake.seed("company_settings", [
    { organization_id: "org-1", key: "company_name", value: "AAA Disaster Recovery" },
  ]);
  return fake;
}

describe("POST /api/contracts/send — branded card (#691)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
    vi.stubEnv("SIGNING_LINK_SECRET", "x".repeat(40));
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(seedHappyPath().client as never);
    vi.mocked(resolveEmailTemplate).mockResolvedValue({
      subject: "Please sign Roof Replacement Agreement",
      html: "<p>Hi Pat, please review and sign at your convenience.</p>",
      unresolvedFields: [],
    });
    vi.mocked(sendContractEmail).mockResolvedValue({
      messageId: "msg-1",
      provider: "resend",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends a message-only body (no {{signing_link}} token) — the body guard is gone", async () => {
    const res = await POST(sendRequest(MESSAGE_ONLY_BODY), routeCtx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.messageId).toBe("msg-1");
    expect(json.contractId).toBeTruthy();
  });

  it("wraps the message in the branded card, with the signing link on the action button", async () => {
    await POST(sendRequest(MESSAGE_ONLY_BODY), routeCtx);
    const html = vi.mocked(sendContractEmail).mock.calls[0][2].html;
    // The app-owned card shell …
    expect(html).toContain('role="presentation"');
    // … the contractor's message embedded inside …
    expect(html).toContain("please review and sign at your convenience");
    // … and the signing link injected into the action button (not the body).
    expect(html).toMatch(/<a href="https:\/\/app\.test\/sign\/[^"]+"/);
  });

  it("sanitizes the contractor's message before framing it", async () => {
    vi.mocked(resolveEmailTemplate).mockResolvedValue({
      subject: "Please sign Roof Replacement Agreement",
      html: '<p>Safe greeting.</p><script>alert("xss")</script>',
      unresolvedFields: [],
    });
    await POST(sendRequest(MESSAGE_ONLY_BODY), routeCtx);
    const html = vi.mocked(sendContractEmail).mock.calls[0][2].html;
    expect(html).not.toContain("<script");
    expect(html).not.toContain('alert("xss")');
    expect(html).toContain("Safe greeting.");
  });

  it("flows the contractor's branding knobs (button color/label, company name) into the card", async () => {
    // Distinctive, NON-default branding so a hardcoded frame would fail: a
    // purple button, a custom label, a custom company wordmark.
    const branded = makeSupabaseFake();
    branded.seed("contract_email_settings", [
      {
        id: "ce-1",
        organization_id: "org-1",
        provider: "resend",
        send_from_email: "contracts@aaa.test",
        send_from_name: "AAA Contracts",
        default_link_expiry_days: 7,
        reminder_day_offsets: [],
        signing_request_subject_template: "Please sign {{document_title}}",
        signing_request_body_template: "<p>Hi {{customer_name}}.</p>",
        button_label: "Sign the roof contract",
        button_color: "#7c3aed",
        logo_visible: true,
      },
    ]);
    branded.seed("contract_templates", [
      {
        id: "tpl-1",
        organization_id: "org-1",
        name: "Roof Replacement Agreement",
        pdf_storage_path: "templates/roof.pdf",
        version: 1,
        is_active: true,
        signer_role_label: null,
        overlay_fields: [],
      },
    ]);
    branded.seed("jobs", [{ id: "job-1", organization_id: "org-1" }]);
    branded.seed("company_settings", [
      { organization_id: "org-1", key: "company_name", value: "Vanessa's Roofing Co" },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(branded.client as never);

    await POST(sendRequest(MESSAGE_ONLY_BODY), routeCtx);
    const html = vi.mocked(sendContractEmail).mock.calls[0][2].html;
    // The button carries the contractor's custom colour and label …
    expect(html).toContain("#7c3aed");
    expect(html).toContain("Sign the roof contract");
    // … and the card is branded with the company name (logo absent → wordmark).
    // The apostrophe is left raw — safe in an HTML text node — proof the frame
    // escapes injection chars (< > " &) without over-mangling plain text.
    expect(html).toContain("Vanessa's Roofing Co");
  });
});
