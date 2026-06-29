// Issue #605 — Marketing suite: manual review request from the Job page.
//
// These tests pin the SEND ROUTE's wiring — the admin gate, channel selection,
// the A2P-gate email fallback, the double-send warning, the review-target
// failure modes, dispatch-before-log ordering, and that every send is logged
// with the org/job/contact/channel/sender. The pure logic (link/message
// building, channel selection, prior-send summary) is covered exhaustively in
// src/lib/reviews/review-request.test.ts, so here those functions run for real
// and only the I/O collaborators (Google, Twilio, email) are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));
vi.mock("@/lib/google/business-profile", () => ({
  getOrganizationReviewTarget: vi.fn(),
}));
vi.mock("@/lib/phone/twilio-client", () => ({
  createTwilioClient: vi.fn(() => ({})),
  sendSms: vi.fn(),
}));
vi.mock("@/lib/email/send", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email/send")>(
    "@/lib/email/send",
  );
  return { ...actual, sendOrgEmail: vi.fn() };
});
vi.mock("@/lib/phone/feature-flags", () => ({
  isPhoneOutboundEnabled: vi.fn(),
}));

import { GET, POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { getOrganizationReviewTarget } from "@/lib/google/business-profile";
import { sendSms } from "@/lib/phone/twilio-client";
import { sendOrgEmail, FromUnconfiguredError } from "@/lib/email/send";
import { isPhoneOutboundEnabled } from "@/lib/phone/feature-flags";
import {
  fakeUserClient,
  fakeServiceClient,
  memberTables,
} from "../../../__test-utils__/request-context-fakes";

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postBody(body: unknown = {}) {
  return new Request("http://test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// An active Shared number the outbound-number rule can pick.
const SHARED_NUMBER = {
  id: "num-1",
  organization_id: "org-1",
  twilio_sid: "PNxxx",
  e164: "+18005551000",
  kind: "shared",
  user_id: null,
  released_at: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
};

const REVIEW_TARGET = {
  reviewLink: "https://g.page/r/abc123/review",
  businessName: "AAA Contracting",
};

// A caller who is an admin of org-1. The User client is what the wrapper
// authenticates against; the Service client is what the route body reads/writes.
function adminUserClient() {
  return fakeUserClient({
    user: { id: "user-1" },
    tables: memberTables({ userId: "user-1", role: "admin" }),
  });
}

// Seed the Service client with a Job + contact (+ any extra tables).
function serviceWith(extra: Record<string, unknown[]> = {}) {
  return fakeServiceClient({
    tables: {
      jobs: [{ id: "job-1", organization_id: "org-1", contact_id: "contact-1" }],
      contacts: [
        {
          id: "contact-1",
          phone: "(212) 555-0142",
          email: "jo@acme.com",
          full_name: "Jo Smith",
        },
      ],
      user_profiles: [{ id: "user-1", full_name: "Eric Daniels" }],
      phone_numbers: [SHARED_NUMBER],
      ...extra,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(getOrganizationReviewTarget).mockResolvedValue(REVIEW_TARGET);
  vi.mocked(sendSms).mockResolvedValue({ sid: "SMxxx", status: "queued" });
  vi.mocked(sendOrgEmail).mockResolvedValue({
    messageId: "m1",
    provider: "resend",
  });
  // SMS path live by default; the A2P-gate test flips this off.
  vi.mocked(isPhoneOutboundEnabled).mockReturnValue(true);
});

describe("POST /api/jobs/[id]/review-request — access", () => {
  it("returns 403 for a non-admin caller", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "crew_lead",
          grants: ["view_phone"],
        }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(serviceWith() as never);

    const res = await POST(postBody(), paramsFor("job-1"));

    expect(res.status).toBe(403);
    expect(sendSms).not.toHaveBeenCalled();
    expect(sendOrgEmail).not.toHaveBeenCalled();
  });

  it("returns 404 without sending when the Job is not in the caller's org", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      adminUserClient() as never,
    );
    // Service client has no matching job row for job-1 in org-1.
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({ tables: { jobs: [] } }) as never,
    );

    const res = await POST(postBody(), paramsFor("job-1"));

    expect(res.status).toBe(404);
    expect(sendSms).not.toHaveBeenCalled();
  });
});

describe("POST /api/jobs/[id]/review-request — channel selection", () => {
  it("sends by SMS to the normalized number and logs the send (201)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      adminUserClient() as never,
    );
    const service = serviceWith();
    vi.mocked(createServiceClient).mockReturnValue(service as never);

    const res = await POST(postBody(), paramsFor("job-1"));

    expect(res.status).toBe(201);
    expect(sendSms).toHaveBeenCalledTimes(1);
    const smsArgs = vi.mocked(sendSms).mock.calls[0][1];
    expect(smsArgs.from).toBe("+18005551000");
    expect(smsArgs.to).toBe("+12125550142");
    expect(smsArgs.body).toContain("https://g.page/r/abc123/review");
    expect(smsArgs.body).toContain("AAA Contracting");
    expect(sendOrgEmail).not.toHaveBeenCalled();

    // The send is logged with org/job/contact/channel/sender.
    const logged = service.__mutations.find(
      (m) => m.table === "review_requests" && m.op === "insert",
    );
    expect(logged?.payload).toMatchObject({
      organization_id: "org-1",
      job_id: "job-1",
      contact_id: "contact-1",
      channel: "sms",
      sent_to: "+12125550142",
      review_link: "https://g.page/r/abc123/review",
      sent_by_user_id: "user-1",
      sent_by_name: "Eric Daniels",
    });
  });

  it("falls back to email when the contact has no usable phone", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      adminUserClient() as never,
    );
    const service = serviceWith({
      contacts: [
        {
          id: "contact-1",
          phone: null,
          email: "jo@acme.com",
          full_name: "Jo Smith",
        },
      ],
    });
    vi.mocked(createServiceClient).mockReturnValue(service as never);

    const res = await POST(postBody(), paramsFor("job-1"));

    expect(res.status).toBe(201);
    expect(sendOrgEmail).toHaveBeenCalledTimes(1);
    expect(sendSms).not.toHaveBeenCalled();
    const [, , emailArgs] = vi.mocked(sendOrgEmail).mock.calls[0];
    expect(emailArgs.to).toBe("jo@acme.com");
    expect(emailArgs.subject).toContain("AAA Contracting");
    expect(emailArgs.html).toContain("https://g.page/r/abc123/review");
    expect(emailArgs.html).toContain("<a href=");

    const logged = service.__mutations.find(
      (m) => m.table === "review_requests" && m.op === "insert",
    );
    expect(logged?.payload).toMatchObject({ channel: "email", sent_to: "jo@acme.com" });
  });

  it("returns 422 without sending when the customer has no phone or email", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      adminUserClient() as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      serviceWith({
        contacts: [
          { id: "contact-1", phone: null, email: null, full_name: "Jo Smith" },
        ],
      }) as never,
    );

    const res = await POST(postBody(), paramsFor("job-1"));

    expect(res.status).toBe(422);
    expect(sendSms).not.toHaveBeenCalled();
    expect(sendOrgEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/jobs/[id]/review-request — A2P gate", () => {
  it("falls back to email when SMS is gated but the contact has an email", async () => {
    vi.mocked(isPhoneOutboundEnabled).mockReturnValue(false);
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      adminUserClient() as never,
    );
    const service = serviceWith();
    vi.mocked(createServiceClient).mockReturnValue(service as never);

    const res = await POST(postBody(), paramsFor("job-1"));

    expect(res.status).toBe(201);
    expect(sendSms).not.toHaveBeenCalled();
    expect(sendOrgEmail).toHaveBeenCalledTimes(1);
    const logged = service.__mutations.find(
      (m) => m.table === "review_requests" && m.op === "insert",
    );
    expect(logged?.payload).toMatchObject({ channel: "email" });
  });

  it("returns 503 when SMS is gated and the contact has no email", async () => {
    vi.mocked(isPhoneOutboundEnabled).mockReturnValue(false);
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      adminUserClient() as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      serviceWith({
        contacts: [
          {
            id: "contact-1",
            phone: "(212) 555-0142",
            email: null,
            full_name: "Jo Smith",
          },
        ],
      }) as never,
    );

    const res = await POST(postBody(), paramsFor("job-1"));

    expect(res.status).toBe(503);
    expect(sendSms).not.toHaveBeenCalled();
    expect(sendOrgEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/jobs/[id]/review-request — double-send guard", () => {
  it("returns 409 with the prior-send summary when already asked and not acknowledged", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      adminUserClient() as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      serviceWith({
        review_requests: [
          {
            id: "rr-1",
            job_id: "job-1",
            channel: "sms",
            created_at: "2026-06-01T10:00:00Z",
            sent_by_name: "Eric Daniels",
          },
        ],
      }) as never,
    );

    const res = await POST(postBody(), paramsFor("job-1"));

    expect(res.status).toBe(409);
    const json = (await res.json()) as {
      error: string;
      summary: { alreadyRequested: boolean; count: number };
    };
    expect(json.error).toBe("already_requested");
    expect(json.summary).toMatchObject({ alreadyRequested: true, count: 1 });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("sends anyway when the admin acknowledges the prior request", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      adminUserClient() as never,
    );
    const service = serviceWith({
      review_requests: [
        {
          id: "rr-1",
          job_id: "job-1",
          channel: "sms",
          created_at: "2026-06-01T10:00:00Z",
          sent_by_name: "Eric Daniels",
        },
      ],
    });
    vi.mocked(createServiceClient).mockReturnValue(service as never);

    const res = await POST(postBody({ acknowledged: true }), paramsFor("job-1"));

    expect(res.status).toBe(201);
    expect(sendSms).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/jobs/[id]/review-request — review target failures", () => {
  it("returns 422 without sending when there is no review link", async () => {
    vi.mocked(getOrganizationReviewTarget).mockResolvedValue(null);
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      adminUserClient() as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(serviceWith() as never);

    const res = await POST(postBody(), paramsFor("job-1"));

    expect(res.status).toBe(422);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("returns 502 when Google Business Profile errors", async () => {
    vi.mocked(getOrganizationReviewTarget).mockRejectedValue(
      new Error("Google Business Profile request failed (500)"),
    );
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      adminUserClient() as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(serviceWith() as never);

    const res = await POST(postBody(), paramsFor("job-1"));

    expect(res.status).toBe(502);
    expect(sendSms).not.toHaveBeenCalled();
  });
});

describe("POST /api/jobs/[id]/review-request — dispatch failures", () => {
  it("returns 502 and does not log when Twilio fails", async () => {
    vi.mocked(sendSms).mockRejectedValue(new Error("network"));
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      adminUserClient() as never,
    );
    const service = serviceWith();
    vi.mocked(createServiceClient).mockReturnValue(service as never);

    const res = await POST(postBody(), paramsFor("job-1"));

    expect(res.status).toBe(502);
    const logged = service.__mutations.find(
      (m) => m.table === "review_requests" && m.op === "insert",
    );
    expect(logged).toBeUndefined();
  });

  it("returns 422 when the org has no send-from email configured", async () => {
    vi.mocked(sendOrgEmail).mockRejectedValue(new FromUnconfiguredError());
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      adminUserClient() as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      serviceWith({
        contacts: [
          { id: "contact-1", phone: null, email: "jo@acme.com", full_name: "Jo" },
        ],
      }) as never,
    );

    const res = await POST(postBody(), paramsFor("job-1"));

    expect(res.status).toBe(422);
  });

  it("returns 422 without sending when the org has no number to send from", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      adminUserClient() as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      serviceWith({ phone_numbers: [] }) as never,
    );

    const res = await POST(postBody(), paramsFor("job-1"));

    expect(res.status).toBe(422);
    expect(sendSms).not.toHaveBeenCalled();
  });
});

describe("GET /api/jobs/[id]/review-request", () => {
  it("returns 403 for a non-admin caller", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "crew_lead" }),
      }) as never,
    );

    const res = await GET(new Request("http://test"), paramsFor("job-1"));

    expect(res.status).toBe(403);
  });

  it("returns the Job's review-request history for an admin", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: {
          ...memberTables({ userId: "user-1", role: "admin" }),
          review_requests: [
            {
              id: "rr-1",
              job_id: "job-1",
              channel: "sms",
              sent_to: "+12125550142",
              review_link: "https://g.page/r/abc123/review",
              sent_by_user_id: "user-1",
              sent_by_name: "Eric Daniels",
              created_at: "2026-06-01T10:00:00Z",
            },
          ],
        },
      }) as never,
    );

    const res = await GET(new Request("http://test"), paramsFor("job-1"));

    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("rr-1");
  });
});
