// PRD #304 — Nookleus Phone. Slice 3 (#307) — number-picker route.
//
// GET /api/phone/numbers/available?areaCode=512
// Returns the Twilio "available local numbers" list, narrowed to the
// fields the UI needs. Admin-only (the Add Shared Number flow is admin).
// The Twilio call is mocked.

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

const listAvailableLocalNumbersMock = vi.fn();
vi.mock("@/lib/phone/twilio-client", () => ({
  listAvailableLocalNumbers: (...args: unknown[]) =>
    listAvailableLocalNumbersMock(...args),
  createTwilioClient: () => ({}),
}));

import { GET } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "@/app/api/email/__test-utils__/request-context-fakes";

const noParams = { params: Promise.resolve({}) };

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  listAvailableLocalNumbersMock.mockResolvedValue([]);
});

describe("GET /api/phone/numbers/available — admin-only picker", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });

    const res = await GET(
      new Request("http://test/api/phone/numbers/available?areaCode=512"),
      noParams,
    );

    expect(res.status).toBe(401);
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

    const res = await GET(
      new Request("http://test/api/phone/numbers/available?areaCode=512"),
      noParams,
    );

    expect(res.status).toBe(403);
    expect(listAvailableLocalNumbersMock).not.toHaveBeenCalled();
  });

  it("returns 400 when areaCode is missing", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await GET(
      new Request("http://test/api/phone/numbers/available"),
      noParams,
    );

    expect(res.status).toBe(400);
  });

  it("returns the Twilio list for admins", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    listAvailableLocalNumbersMock.mockResolvedValue([
      {
        phoneNumber: "+15125551234",
        friendlyName: "(512) 555-1234",
        locality: "Austin",
        region: "TX",
      },
    ]);

    const res = await GET(
      new Request("http://test/api/phone/numbers/available?areaCode=512"),
      noParams,
    );

    expect(res.status).toBe(200);
    expect(listAvailableLocalNumbersMock).toHaveBeenCalledWith(
      expect.anything(),
      "512",
    );
    const body = await res.json();
    expect(body).toEqual([
      {
        phoneNumber: "+15125551234",
        friendlyName: "(512) 555-1234",
        locality: "Austin",
        region: "TX",
      },
    ]);
  });

  it("returns 502 when Twilio errors", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    listAvailableLocalNumbersMock.mockRejectedValue(new Error("twilio: 503"));

    const res = await GET(
      new Request("http://test/api/phone/numbers/available?areaCode=512"),
      noParams,
    );

    expect(res.status).toBe(502);
  });
});
