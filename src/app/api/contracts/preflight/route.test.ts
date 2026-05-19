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
  makeSupabaseFake,
  makeAuthedFake,
  makeUnauthedFake,
} from "@/lib/contracts/__test-utils__/supabase-fake";

function makeRequest(): Request {
  return new Request("http://test/api/contracts/preflight");
}

// preflight is non-dynamic; the wrapper still passes a route context.
const routeCtx = { params: Promise.resolve({}) };

// #106 — preflight is a contracts read, gated on `view_jobs` (contracts are
// job sub-resources). A holder / admin passes the gate and the handler then
// returns 400 for the missing query params — proof the wrapper let it run.
describe("GET /api/contracts/preflight — permission gate (#106)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServiceClient).mockReturnValue(
      makeSupabaseFake().client as never,
    );
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeUnauthedFake() as never,
    );
    const res = await GET(makeRequest(), routeCtx);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller has no job permissions", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member", grants: [] }) as never,
    );
    const res = await GET(makeRequest(), routeCtx);
    expect(res.status).toBe(403);
  });

  it("a member holding view_jobs passes the gate", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member", grants: ["view_jobs"] }) as never,
    );
    const res = await GET(makeRequest(), routeCtx);
    expect(res.status).toBe(400);
  });

  it("an admin passes the gate", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const res = await GET(makeRequest(), routeCtx);
    expect(res.status).toBe(400);
  });
});
