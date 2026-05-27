// PRD #304 — Nookleus Phone. Slice 4 (#308).
//
// GET /api/phone/conversations/[id]/messages — return the messages in the
// conversation, sorted by `sent_at` ascending. RLS enforces the ADR 0003
// matrix; the route is a thin pass-through.

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

import { GET } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "@/app/api/email/__test-utils__/request-context-fakes";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("GET /api/phone/conversations/[id]/messages", () => {
  it("returns 401 unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );
    const res = await GET(
      new Request("http://test/api/phone/conversations/conv-1/messages"),
      params("conv-1"),
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller lacks view_phone", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "u-1" },
        tables: memberTables({ userId: "u-1", role: "crew_member", grants: [] }),
      }) as never,
    );
    const res = await GET(
      new Request("http://test/api/phone/conversations/conv-1/messages"),
      params("conv-1"),
    );
    expect(res.status).toBe(403);
  });

  it("returns the conversation's messages for an authorized caller", async () => {
    const tables = memberTables({
      userId: "u-1",
      role: "crew_lead",
      grants: ["view_phone"],
    });
    tables.phone_messages = [
      {
        id: "m-1",
        organization_id: "org-1",
        conversation_id: "conv-1",
        direction: "in",
        from_e164: "+15551234567",
        to_e164: "+15125550000",
        body: "Hi",
        media_urls: [],
        twilio_sid: "SM-1",
        status: "received",
        job_tag: null,
        tagged_by_user_id: null,
        sent_by_user_id: null,
        sent_at: "2026-05-27T10:00:00Z",
      },
    ];
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: { id: "u-1" }, tables }) as never,
    );

    const res = await GET(
      new Request("http://test/api/phone/conversations/conv-1/messages"),
      params("conv-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([expect.objectContaining({ id: "m-1", body: "Hi" })]);
  });
});
