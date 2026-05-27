// PRD #304 — Nookleus Phone. Slice 3 (#307) — release-number route.
//
// POST /api/phone/numbers/[id]/release
// Admin-only. Calls Twilio's incomingPhoneNumbers(sid).remove(), then
// soft-deletes the row by setting released_at. AC bullet:
//   "Admin can release a Shared number — Twilio confirms the release on
//    its side, and the row in phone_numbers is marked released_at"
//
// Ordering: Twilio first, DB second. Twilio billing is the thing we don't
// want to leave stale; a successful Twilio remove + DB failure is
// recoverable (admin retries; Twilio's remove of an already-removed SID
// errors cleanly and the row can be marked released_at on retry). The
// reverse order is not recoverable — a row marked released while the
// number stays on Twilio means we keep paying for a number nobody can
// see in the app.

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

const releaseNumberMock = vi.fn();
vi.mock("@/lib/phone/twilio-client", () => ({
  releaseNumber: (...args: unknown[]) => releaseNumberMock(...args),
  createTwilioClient: () => ({}),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeServiceClient,
  fakeUserClient,
  memberTables,
} from "@/app/api/email/__test-utils__/request-context-fakes";

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

const SHARED_ROW = {
  id: "row-shared",
  organization_id: "org-1",
  twilio_sid: "PNshared",
  e164: "+15125551234",
  kind: "shared" as const,
  user_id: null,
  released_at: null,
};

function serviceWithRow(row: Record<string, unknown>) {
  vi.mocked(createServiceClient).mockReturnValue(
    fakeServiceClient({ tables: { phone_numbers: [row] } }) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  serviceWithRow(SHARED_ROW);
  releaseNumberMock.mockResolvedValue(undefined);
});

describe("POST /api/phone/numbers/[id]/release", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });

    const res = await POST(
      new Request("http://test", { method: "POST" }),
      idParams("row-shared"),
    );

    expect(res.status).toBe(401);
    expect(releaseNumberMock).not.toHaveBeenCalled();
  });

  it("returns 403 when caller is not an admin", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_lead",
        grants: ["view_phone"],
      }),
    });

    const res = await POST(
      new Request("http://test", { method: "POST" }),
      idParams("row-shared"),
    );

    expect(res.status).toBe(403);
    expect(releaseNumberMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the row does not exist", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    // Service-client table is empty.
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({ tables: { phone_numbers: [] } }) as never,
    );

    const res = await POST(
      new Request("http://test", { method: "POST" }),
      idParams("missing"),
    );

    expect(res.status).toBe(404);
    expect(releaseNumberMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the row is in another organization (canManage denies cross-org)", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    serviceWithRow({ ...SHARED_ROW, organization_id: "org-other" });

    const res = await POST(
      new Request("http://test", { method: "POST" }),
      idParams("row-shared"),
    );

    expect(res.status).toBe(404);
    expect(releaseNumberMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the row is already released (released_at non-null)", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    serviceWithRow({
      ...SHARED_ROW,
      released_at: "2026-05-01T00:00:00Z",
    });

    const res = await POST(
      new Request("http://test", { method: "POST" }),
      idParams("row-shared"),
    );

    expect(res.status).toBe(409);
    expect(releaseNumberMock).not.toHaveBeenCalled();
  });

  it("admin releases: calls Twilio with the SID, then marks released_at", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await POST(
      new Request("http://test", { method: "POST" }),
      idParams("row-shared"),
    );

    expect(res.status).toBe(200);
    expect(releaseNumberMock).toHaveBeenCalledWith(
      expect.anything(),
      "PNshared",
    );
  });

  it("returns 502 when Twilio errors and does NOT mark released_at", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    releaseNumberMock.mockRejectedValue(new Error("twilio: 500"));

    const res = await POST(
      new Request("http://test", { method: "POST" }),
      idParams("row-shared"),
    );

    expect(res.status).toBe(502);
  });
});
