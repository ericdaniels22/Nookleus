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
} from "../__test-utils__/request-context-fakes";

const noParams = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("GET /api/email/list (converted to withRequestContext)", () => {
  it("returns 401 when unauthenticated — the route body never runs", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );

    const res = await GET(new Request("http://test/api/email/list"), noParams);

    expect(res.status).toBe(401);
  });

  it("lists emails for any logged-in caller — it was ungated, so no permission is required", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: {
          ...memberTables({ userId: "user-1", role: "crew_member", grants: [] }),
          emails: [
            { id: "e-1", folder: "inbox" },
            { id: "e-2", folder: "inbox" },
            { id: "e-3", folder: "sent" },
          ],
        },
      }) as never,
    );

    const res = await GET(new Request("http://test/api/email/list"), noParams);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.emails.map((e: { id: string }) => e.id)).toEqual(["e-1", "e-2"]);
  });
});
