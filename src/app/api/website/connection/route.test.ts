import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));

import { GET } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import {
  makeAuthedFake,
  makeUnauthedFake,
} from "@/lib/contracts/__test-utils__/supabase-fake";

// Service fake supporting select("*").eq("organization_id", x).maybeSingle().
function makeServiceFake(rows: Record<string, unknown>[] = []) {
  const client = {
    from(table: string) {
      if (table !== "website_connection") throw new Error(`unexpected table: ${table}`);
      return {
        select() {
          const filters: Array<[string, unknown]> = [];
          const api = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return api;
            },
            async maybeSingle() {
              const match = rows.find((r) => filters.every(([c, v]) => r[c] === v));
              return { data: match ?? null, error: null };
            },
          };
          return api;
        },
      };
    },
  };
  return { client, rows };
}

function connectedRow() {
  return {
    id: "row-1",
    organization_id: "org-1",
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
  return new Request("http://test/api/website/connection");
}
const routeCtx = { params: Promise.resolve({}) };

describe("GET /api/website/connection (#612)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServiceClient).mockReturnValue(makeServiceFake().client as never);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(makeUnauthedFake() as never);
    expect((await GET(makeRequest(), routeCtx)).status).toBe(401);
  });

  it("returns 403 for a non-admin member (admin only)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member" }) as never,
    );
    expect((await GET(makeRequest(), routeCtx)).status).toBe(403);
  });

  it("reports disconnected when the org has no connection", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(makeServiceFake([]).client as never);

    const json = await (await GET(makeRequest(), routeCtx)).json();
    expect(json.state).toBe("disconnected");
    expect(json.site_url).toBeNull();
  });

  it("reports the connection summary WITHOUT leaking the Application Password", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      makeServiceFake([connectedRow()]).client as never,
    );

    const res = await GET(makeRequest(), routeCtx);
    const json = await res.json();
    expect(json.state).toBe("connected");
    expect(json.site_url).toBe("https://aaadisasterrecovery.com");
    expect(json.account_name).toBe("AAA Disaster Recovery");

    const raw = JSON.stringify(json);
    expect(raw).not.toContain("cipher");
    expect(raw).not.toContain("application_password");
  });
});
