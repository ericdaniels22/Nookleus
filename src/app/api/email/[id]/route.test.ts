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

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("GET /api/email/[id] (converted to withRequestContext)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );

    const res = await GET(new Request("http://test"), paramsFor("e-1"));

    expect(res.status).toBe(401);
  });

  it("returns the email and passes the dynamic [id] param through to the handler", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: {
          ...memberTables({ userId: "user-1", role: "crew_member", grants: [] }),
          emails: [{ id: "e-1", subject: "Hello" }],
        },
      }) as never,
    );

    const res = await GET(new Request("http://test"), paramsFor("e-1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "e-1", subject: "Hello" });
  });

  it("returns 404 when the email is not found", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: {
          ...memberTables({ userId: "user-1", role: "crew_member", grants: [] }),
          emails: [],
        },
      }) as never,
    );

    const res = await GET(new Request("http://test"), paramsFor("missing"));

    expect(res.status).toBe(404);
  });
});
