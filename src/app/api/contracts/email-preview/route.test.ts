import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));
// The merge-field engine (a deep subsystem with its own tests) is stubbed at
// its module boundary so a route test needn't seed the whole job/contact/
// intake-form graph. Everything the preview seam reuses — the draft overlay,
// sanitize → loadEmailBranding → renderContractEmailFrame — runs for real.
vi.mock("@/lib/contracts/email-merge-fields", () => ({
  resolveEmailTemplate: vi.fn(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { resolveEmailTemplate } from "@/lib/contracts/email-merge-fields";
import {
  makeSupabaseFake,
  makeAuthedFake,
  makeUnauthedFake,
  type SupabaseFake,
} from "@/lib/contracts/__test-utils__/supabase-fake";

function previewRequest(body: Record<string, unknown>): Request {
  return new Request("http://test/api/contracts/email-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const routeCtx = { params: Promise.resolve({}) };

function seedSettings(fake: SupabaseFake): SupabaseFake {
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
      reminder_subject_template: "Reminder: sign {{document_title}}",
      reminder_body_template: "<p>Just a nudge, {{customer_name}}.</p>",
      button_label: "Review & sign",
      button_color: "#1f2937",
      logo_visible: false,
    },
  ]);
  fake.seed("company_settings", [
    { organization_id: "org-1", key: "company_name", value: "AAA Disaster Recovery" },
  ]);
  return fake;
}

// The preview serves two audiences, so its gate is any-of: a contract-send
// user (edit_jobs) OR a settings editor (access_settings) may preview.
describe("POST /api/contracts/email-preview — permission gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
    vi.mocked(createServiceClient).mockReturnValue(
      seedSettings(makeSupabaseFake()).client as never,
    );
    vi.mocked(resolveEmailTemplate).mockResolvedValue({
      subject: "s",
      html: "<p>m</p>",
      unresolvedFields: [],
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(makeUnauthedFake() as never);
    const res = await POST(previewRequest({ jobId: "job-1" }), routeCtx);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller holds neither edit_jobs nor access_settings", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member", grants: ["view_jobs"] }) as never,
    );
    const res = await POST(previewRequest({ jobId: "job-1" }), routeCtx);
    expect(res.status).toBe(403);
  });

  it("allows a contract sender (edit_jobs)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member", grants: ["edit_jobs"] }) as never,
    );
    const res = await POST(previewRequest({ jobId: "job-1" }), routeCtx);
    expect(res.status).toBe(200);
  });

  it("allows a settings editor (access_settings)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member", grants: ["access_settings"] }) as never,
    );
    const res = await POST(previewRequest({ jobId: "job-1" }), routeCtx);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/contracts/email-preview — renders the branded card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(seedSettings(makeSupabaseFake()).client as never);
    vi.mocked(resolveEmailTemplate).mockResolvedValue({
      subject: "Please sign Roof Replacement Agreement",
      html: "<p>Hi Jane Homeowner, please review and sign.</p>",
      unresolvedFields: [],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the rendered frame HTML for a (job, kind)", async () => {
    const res = await POST(
      previewRequest({ jobId: "job-1", kind: "signing_request" }),
      routeCtx,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    // The app-owned card shell …
    expect(json.html).toContain('role="presentation"');
    // … wrapping the resolved contractor message.
    expect(json.html).toContain("Hi Jane Homeowner, please review and sign.");
  });

  it("resolves the real job's merge data (customer name resolved for the given job)", async () => {
    const res = await POST(
      previewRequest({ jobId: "job-1", kind: "signing_request" }),
      routeCtx,
    );
    const json = await res.json();
    // The engine was consulted for THIS job's data …
    expect(vi.mocked(resolveEmailTemplate).mock.calls[0][3]).toBe("job-1");
    // … and the resolved customer name surfaces in the card.
    expect(json.html).toContain("Jane Homeowner");
  });

  it("honors unsaved draft settings — draft knobs and message override the persisted row", async () => {
    const res = await POST(
      previewRequest({
        jobId: "job-1",
        kind: "signing_request",
        draftSettings: {
          button_color: "#7c3aed",
          button_label: "Sign the roof contract",
          signing_request_body_template: "<p>Unsaved draft for {{customer_name}}.</p>",
        },
      }),
      routeCtx,
    );
    const json = await res.json();
    // The draft knobs win over the persisted #1f2937 / "Review & sign".
    expect(json.html).toContain("#7c3aed");
    expect(json.html).toContain("Sign the roof contract");
    expect(json.html).not.toContain("#1f2937");
    // The draft message body — not the persisted one — is what gets resolved.
    expect(vi.mocked(resolveEmailTemplate).mock.calls[0][2]).toBe(
      "<p>Unsaved draft for {{customer_name}}.</p>",
    );
  });

  it("changes the icon and headline when the kind changes", async () => {
    const signing = await (
      await POST(previewRequest({ jobId: "job-1", kind: "signing_request" }), routeCtx)
    ).json();
    const reminder = await (
      await POST(previewRequest({ jobId: "job-1", kind: "reminder" }), routeCtx)
    ).json();

    // Signing-request → document icon + first-send headline.
    expect(signing.html).toContain("📄");
    expect(signing.html).toContain("sent you a document to review and sign");
    // Reminder → bell glyph + reminder headline, and the icon actually swaps.
    expect(reminder.html).toContain("🔔");
    expect(reminder.html).not.toContain("📄");
    expect(reminder.html).toContain("is waiting for your signature");
  });

  it("renders a job-less Settings preview with sample merge data", async () => {
    const res = await POST(previewRequest({ kind: "signing_request" }), routeCtx);
    expect(res.status).toBe(200);
    const json = await res.json();
    // No job → the merge engine is never consulted; sample values fill in.
    expect(vi.mocked(resolveEmailTemplate)).not.toHaveBeenCalled();
    expect(json.html).toContain('role="presentation"');
    expect(json.html).toContain("Sample Customer");
  });

  it("rejects an unknown kind", async () => {
    const res = await POST(
      previewRequest({ jobId: "job-1", kind: "not_a_kind" }),
      routeCtx,
    );
    expect(res.status).toBe(400);
  });

  it("returns 500 when the settings row is missing", async () => {
    vi.mocked(createServiceClient).mockReturnValue(makeSupabaseFake().client as never);
    const res = await POST(
      previewRequest({ jobId: "job-1", kind: "signing_request" }),
      routeCtx,
    );
    expect(res.status).toBe(500);
  });
});
