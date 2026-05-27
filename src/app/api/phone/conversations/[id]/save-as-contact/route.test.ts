// PRD #304 — Nookleus Phone. Slice 4 (#308).
//
// POST /api/phone/conversations/[id]/save-as-contact — convert a raw-number
// thread into a real Contact. The thread's `outside_e164` becomes the new
// Contact's `phone`; the body provides the `full_name`. The conversation's
// `contact_id` is then re-pointed at the new Contact.
//
// AC bullet: "An inbound SMS from an unknown number creates a 'raw number'
// thread with contact_id IS NULL; Save as Contact converts it"

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

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeServiceClient,
  fakeUserClient,
  memberTables,
} from "@/app/api/email/__test-utils__/request-context-fakes";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function postReq(body: Record<string, unknown>) {
  return new Request("http://test", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(createServiceClient).mockReturnValue(
    fakeServiceClient({ tables: {} }) as never,
  );
});

describe("POST /api/phone/conversations/[id]/save-as-contact — gated on view_phone", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );
    const res = await POST(postReq({ fullName: "Jane" }), params("conv-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller lacks view_phone (crew_member default)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "u-1" },
        tables: memberTables({ userId: "u-1", role: "crew_member", grants: [] }),
      }) as never,
    );
    const res = await POST(postReq({ fullName: "Jane" }), params("conv-1"));
    expect(res.status).toBe(403);
  });

  it("returns 400 when fullName is missing or empty", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "u-1" },
        tables: memberTables({
          userId: "u-1",
          role: "crew_lead",
          grants: ["view_phone"],
        }),
      }) as never,
    );
    expect(
      (await POST(postReq({ fullName: "" }), params("conv-1"))).status,
    ).toBe(400);
    expect(
      (await POST(postReq({}), params("conv-1"))).status,
    ).toBe(400);
  });

  it("returns 404 when the conversation does not exist or is in another org", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "u-1" },
        tables: memberTables({
          userId: "u-1",
          role: "crew_lead",
          grants: ["view_phone"],
        }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({
        tables: { phone_conversations: [] },
      }) as never,
    );
    const res = await POST(postReq({ fullName: "Jane" }), params("conv-1"));
    expect(res.status).toBe(404);
  });

  it("returns 409 when the conversation already has a contact_id", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "u-1" },
        tables: memberTables({
          userId: "u-1",
          role: "crew_lead",
          grants: ["view_phone"],
        }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({
        tables: {
          phone_conversations: [
            {
              id: "conv-1",
              organization_id: "org-1",
              outside_e164: "+15551234567",
              contact_id: "c-existing",
            },
          ],
        },
      }) as never,
    );
    const res = await POST(postReq({ fullName: "Jane" }), params("conv-1"));
    expect(res.status).toBe(409);
  });

  it("creates a Contact and re-points the conversation when fullName is valid", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "u-1" },
        tables: memberTables({
          userId: "u-1",
          role: "crew_lead",
          grants: ["view_phone"],
        }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({
        tables: {
          phone_conversations: [
            {
              id: "conv-1",
              organization_id: "org-1",
              outside_e164: "+15551234567",
              contact_id: null,
            },
          ],
          contacts: [
            // Will be present after the INSERT (the fake's single()
            // returns the first row, so we seed the resulting row).
            { id: "c-new", full_name: "Jane Doe", phone: "+15551234567" },
          ],
        },
      }) as never,
    );

    const res = await POST(
      postReq({ fullName: "Jane Doe" }),
      params("conv-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      contact: { id: "c-new", full_name: "Jane Doe", phone: "+15551234567" },
    });
  });
});
