// GET /api/referral-partners/trash — Trash list + lazy 30-day sweep.
// Pins the auth gate, the happy-path shape, and confirms the response
// envelope advertises the retention window the UI uses.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
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
} from "../../__test-utils__/request-context-fakes";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

function useUser(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

const REQ = new Request("http://test/api/referral-partners/trash");

describe("GET /api/referral-partners/trash — auth + permission", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await GET(REQ, { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
  });

  it("returns 403 for a crew_member — Trash is admin/crew_lead only", async () => {
    useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "crew_member" }),
    });
    const res = await GET(REQ, { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/referral-partners/trash — happy path", () => {
  it("an admin sees the trashed partners with the retention window", async () => {
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "admin" }),
        referral_partners: [
          {
            id: "p-1",
            organization_id: "org-1",
            company_name: "Acme",
            deleted_at: "2026-05-20T00:00:00.000Z",
          },
        ],
      },
    });
    const res = await GET(REQ, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.retentionDays).toBe(30);
    expect(Array.isArray(body.referral_partners)).toBe(true);
  });

  // ── Slice C1 (#300) AC: Trash row shows `N jobs · X days remaining`. ──
  it("attaches job_count to each trashed partner row from non-trashed jobs", async () => {
    useUser({
      user: { id: "user-1" },
      tables: {
        ...memberTables({ userId: "user-1", role: "admin" }),
        referral_partners: [
          { id: "p-1", organization_id: "org-1", company_name: "Acme",  deleted_at: "2026-05-20T00:00:00.000Z" },
          { id: "p-2", organization_id: "org-1", company_name: "Beta",  deleted_at: "2026-05-21T00:00:00.000Z" },
        ],
        jobs: [
          // Trashed-partner FKs still point at the partner row (soft delete
          // preserves the row); the count rule depends on the Job's own
          // `deleted_at IS NULL`, not the partner's.
          { id: "j-1", referral_partner_id: "p-1", deleted_at: null },
          { id: "j-2", referral_partner_id: "p-1", deleted_at: null },
          { id: "j-3", referral_partner_id: "p-1", deleted_at: null },
        ],
      },
    });
    const res = await GET(REQ, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    const byId = Object.fromEntries(
      (body.referral_partners as Array<{ id: string; job_count: number }>).map(
        (p) => [p.id, p.job_count],
      ),
    );
    expect(byId).toEqual({ "p-1": 3, "p-2": 0 });
  });
});
