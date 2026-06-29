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
// The AI drafter is replaced wholesale: these tests prove the route's wiring
// (auth, org-scoping, match assembly, response shape) without an API key.
vi.mock("@/lib/reviews/review-reply-draft", () => ({
  draftReviewReply: vi.fn(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { draftReviewReply } from "@/lib/reviews/review-reply-draft";
import {
  fakeClient,
  memberTables,
} from "@/lib/request-context/__test-utils__/request-context-fakes";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const postReq = () =>
  new Request("http://test/api/google/reviews/rev-1/suggest", {
    method: "POST",
  });

function useUser(opts: Parameters<typeof fakeClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(fakeClient(opts) as never);
}

function useService(tables?: Record<string, Record<string, unknown>[]>) {
  vi.mocked(createServiceClient).mockReturnValue(fakeClient({ tables }) as never);
}

// An admin caller plus a service client seeded with one unreplied review.
function adminReviewService(
  extraTables: Record<string, Record<string, unknown>[]> = {},
) {
  useUser({
    user: { id: "u-1" },
    tables: memberTables({ userId: "u-1", role: "admin" }),
  });
  useService({
    google_review: [
      {
        id: "rev-1",
        organization_id: "org-1",
        google_review_id: "g-rev-1",
        location_name: "accounts/1/locations/2",
        reviewer_name: "Jane Doe",
        star_rating: 5,
        comment: "Great service, fast and tidy.",
        replied: false,
      },
    ],
    ...extraTables,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// POST /api/google/reviews/[id]/suggest — draft (but never post or persist) an
// AI-suggested reply to one review. Admin only. #608 AC1/AC3.
describe("POST /api/google/reviews/[id]/suggest", () => {
  it("returns an AI-drafted suggested reply and writes/posts nothing", async () => {
    adminReviewService();
    vi.mocked(draftReviewReply).mockResolvedValue(
      "Thanks so much for the kind words!",
    );

    const res = await POST(postReq(), params("rev-1"));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.suggested_reply).toBe("Thanks so much for the kind words!");
    // Draft only — nothing is marked replied here (#608 AC1/AC3).
    expect(data.replied).toBeUndefined();
  });

  it("returns 401 when unauthenticated and never drafts", async () => {
    useUser({ user: null });
    useService();

    const res = await POST(postReq(), params("rev-1"));

    expect(res.status).toBe(401);
    expect(vi.mocked(draftReviewReply)).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-admin even with a marketing permission grant", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({
        userId: "u-1",
        role: "member",
        grants: ["view_marketing"],
      }),
    });
    useService();

    const res = await POST(postReq(), params("rev-1"));

    expect(res.status).toBe(403);
    expect(vi.mocked(draftReviewReply)).not.toHaveBeenCalled();
  });

  it("returns 404 and never drafts for a review that belongs to another org", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "admin" }),
    });
    useService({
      google_review: [
        {
          id: "rev-1",
          organization_id: "org-2",
          reviewer_name: "Jane Doe",
          star_rating: 5,
          comment: "Great",
          replied: false,
        },
      ],
    });

    const res = await POST(postReq(), params("rev-1"));

    expect(res.status).toBe(404);
    expect(vi.mocked(draftReviewReply)).not.toHaveBeenCalled();
  });

  it("passes the reviewer's matched contact and job to the drafter as private context", async () => {
    adminReviewService({
      contacts: [
        { id: "c-1", organization_id: "org-1", full_name: "Jane Doe" },
        { id: "c-2", organization_id: "org-1", full_name: "Someone Else" },
      ],
      jobs: [
        {
          id: "j-1",
          organization_id: "org-1",
          job_number: "WTR-2026-0001",
          property_address: "12 Oak St",
          contact_id: "c-1",
        },
      ],
    });
    vi.mocked(draftReviewReply).mockResolvedValue("Thanks!");

    await POST(postReq(), params("rev-1"));

    expect(vi.mocked(draftReviewReply)).toHaveBeenCalledTimes(1);
    const [reviewArg, matchArg] = vi.mocked(draftReviewReply).mock.calls[0];
    expect(reviewArg).toMatchObject({ star_rating: 5, reviewer_name: "Jane Doe" });
    expect(matchArg).toEqual({
      contact_id: "c-1",
      contact_name: "Jane Doe",
      job: { id: "j-1", job_number: "WTR-2026-0001", property_address: "12 Oak St" },
    });
  });

  it("surfaces a drafting failure instead of swallowing it", async () => {
    adminReviewService();
    vi.mocked(draftReviewReply).mockRejectedValue(new Error("anthropic 529"));

    const res = await POST(postReq(), params("rev-1"));

    // The failure is reported, not turned into an empty/blank suggestion (#608 AC5).
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.suggested_reply).toBeUndefined();
    expect(data.error).toBeTruthy();
  });
});
