// PRD #304 — Nookleus Phone. Slice 4 (#308).
//
// GET /api/phone/conversations — list every Conversation in the active org
// sorted by `last_event_at` desc, with unread on top. RLS handles org
// scoping and Personal-number visibility. The route is a thin pass-through.

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

const noParams = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("GET /api/phone/conversations", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );
    const res = await GET(
      new Request("http://test/api/phone/conversations"),
      noParams,
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
      new Request("http://test/api/phone/conversations"),
      noParams,
    );
    expect(res.status).toBe(403);
  });

  it("returns conversations seeded in the org for the caller", async () => {
    const tables = memberTables({
      userId: "u-1",
      role: "crew_lead",
      grants: ["view_phone"],
    });
    tables.phone_conversations = [
      {
        id: "conv-1",
        organization_id: "org-1",
        phone_number_id: "pn-1",
        outside_e164: "+15551234567",
        contact_id: null,
        last_event_at: "2026-05-27T10:00:00Z",
        unread_count: 2,
        deleted_at: null,
      },
    ];
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: { id: "u-1" }, tables }) as never,
    );

    const res = await GET(
      new Request("http://test/api/phone/conversations"),
      noParams,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      expect.objectContaining({
        id: "conv-1",
        outside_e164: "+15551234567",
        unread_count: 2,
      }),
    ]);
  });
});
