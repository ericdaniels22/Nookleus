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
  return new Request("http://test/api/contracts/c-1/pdf");
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

// #106 — the signed-PDF download is a contracts read, gated on `view_jobs`.
// A holder / admin passes the gate; with no contract seeded the handler then
// returns 404 — proof the wrapper let it run.
describe("GET /api/contracts/[id]/pdf — permission gate (#106)", () => {
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
    const res = await GET(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller has no job permissions", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member", grants: [] }) as never,
    );
    const res = await GET(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(403);
  });

  it("a member holding view_jobs passes the gate", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member", grants: ["view_jobs"] }) as never,
    );
    const res = await GET(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(404);
  });

  it("an admin passes the gate", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const res = await GET(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(404);
  });
});
