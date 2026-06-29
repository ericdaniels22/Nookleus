import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import {
  makeAuthedFake,
  makeUnauthedFake,
} from "@/lib/contracts/__test-utils__/supabase-fake";

// Service fake supporting delete().eq("organization_id", x). Rows are exposed so
// a test can prove the org's connection was actually removed.
function makeServiceFake(rows: Record<string, unknown>[] = []) {
  const client = {
    from(table: string) {
      if (table !== "website_connection") throw new Error(`unexpected table: ${table}`);
      return {
        delete() {
          const filters: Array<[string, unknown]> = [];
          const api = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              for (let i = rows.length - 1; i >= 0; i--) {
                if (filters.every(([c, v]) => rows[i][c] === v)) rows.splice(i, 1);
              }
              return Promise.resolve({ data: null, error: null });
            },
          };
          return api;
        },
      };
    },
  };
  return { client, rows };
}

function connectedRow(orgId = "org-1") {
  return {
    id: "row-1",
    organization_id: orgId,
    provider: "wordpress",
    site_url: "https://aaadisasterrecovery.com",
    username: "marketing",
    application_password_encrypted: "iv:tag:cipher",
    account_name: "AAA Disaster Recovery",
    status: "connected",
    broken_reason: null,
    broken_at: null,
    connected_by: "user-1",
    created_at: "2026-06-27T11:00:00.000Z",
    updated_at: "2026-06-27T11:00:00.000Z",
  };
}

function makeRequest(): Request {
  return new Request("http://test/api/website/disconnect", { method: "POST" });
}
const routeCtx = { params: Promise.resolve({}) };

describe("POST /api/website/disconnect (#612)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServiceClient).mockReturnValue(makeServiceFake().client as never);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(makeUnauthedFake() as never);
    expect((await POST(makeRequest(), routeCtx)).status).toBe(401);
  });

  it("returns 403 for a non-admin member (admin only)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member" }) as never,
    );
    expect((await POST(makeRequest(), routeCtx)).status).toBe(403);
  });

  it("deletes the org's connection and returns ok", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const svc = makeServiceFake([connectedRow()]);
    vi.mocked(createServiceClient).mockReturnValue(svc.client as never);

    const res = await POST(makeRequest(), routeCtx);

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(svc.rows).toHaveLength(0); // the credential no longer lingers locally
  });

  it("is idempotent — disconnecting with no connection still returns ok", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const svc = makeServiceFake([]);
    vi.mocked(createServiceClient).mockReturnValue(svc.client as never);

    const res = await POST(makeRequest(), routeCtx);

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
