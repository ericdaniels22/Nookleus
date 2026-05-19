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
  makeSupabaseFake,
  makeAuthedFake,
  makeUnauthedFake,
} from "@/lib/contracts/__test-utils__/supabase-fake";

function makeRequest(): Request {
  return new Request("http://test/api/contracts/c-1/resend", { method: "POST" });
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

// Service fake seeded with a contract-email-settings row that has no
// send-from configured, so a caller past the gate gets a deterministic 400.
function seededService() {
  const service = makeSupabaseFake();
  service.seed("contract_email_settings", [
    { id: "s-1", send_from_email: null, send_from_name: null },
  ]);
  return service;
}

// #106 — resending a signing request is a contracts mutation, gated on
// `edit_jobs`. A holder / admin passes the gate; the handler then returns
// 400 (no send-from configured) — proof the wrapper let it run.
describe("POST /api/contracts/[id]/resend — permission gate (#106)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServiceClient).mockReturnValue(
      seededService().client as never,
    );
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeUnauthedFake() as never,
    );
    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller has no job permissions", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member", grants: [] }) as never,
    );
    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(403);
  });

  it("a member holding edit_jobs passes the gate", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member", grants: ["edit_jobs"] }) as never,
    );
    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(400);
  });

  it("an admin passes the gate", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const res = await POST(makeRequest(), paramsFor("c-1"));
    expect(res.status).toBe(400);
  });
});
