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
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  fakeServiceClient,
  memberTables,
} from "../../__test-utils__/request-context-fakes";

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("GET /api/expenses/[id]/thumbnail-url (org-scoped via the guard)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({}).client as never,
    );

    const res = await GET(new Request("http://test"), paramsFor("exp-1"));

    expect(res.status).toBe(401);
  });

  it("returns a signed URL for an expense in the caller's Active Organization", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({
        tables: {
          expenses: [
            {
              id: "exp-1",
              organization_id: "org-1",
              thumbnail_path: "org-1/exp-1-thumb.jpg",
            },
          ],
        },
      }).client as never,
    );

    const res = await GET(new Request("http://test"), paramsFor("exp-1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toContain("org-1/exp-1-thumb.jpg");
  });

  it("returns 404 for an expense id belonging to another Organization", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({
        tables: {
          expenses: [
            {
              id: "exp-1",
              organization_id: "org-2",
              thumbnail_path: "org-2/exp-1-thumb.jpg",
            },
          ],
        },
      }).client as never,
    );

    const res = await GET(new Request("http://test"), paramsFor("exp-1"));

    expect(res.status).toBe(404);
  });
});
