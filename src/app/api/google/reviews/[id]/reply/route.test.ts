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
vi.mock("@/lib/google/client", () => ({
  getGoogleClient: vi.fn(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { getGoogleClient } from "@/lib/google/client";
import {
  fakeClient,
  memberTables,
} from "@/lib/request-context/__test-utils__/request-context-fakes";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const postReq = (body?: unknown) =>
  new Request("http://test/api/google/reviews/rev-1/reply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

function useUser(opts: Parameters<typeof fakeClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(fakeClient(opts) as never);
}

function useService(tables?: Record<string, Record<string, unknown>[]>) {
  vi.mocked(createServiceClient).mockReturnValue(fakeClient({ tables }) as never);
}

// A fake authorized GoogleClient: its `.fetch` records every call and returns a
// canned v4 ReviewReply (or a non-ok status to simulate a Google post failure).
function useGoogleClient(
  opts: { status?: number; updateTime?: string } = {},
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const client = {
    organizationId: "org-1",
    accountEmail: "biz@example.com",
    getAccessToken: () => "tok",
    fetch: async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          comment: "posted",
          updateTime: opts.updateTime ?? "2026-06-29T12:00:00Z",
        }),
        {
          status: opts.status ?? 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  };
  vi.mocked(getGoogleClient).mockResolvedValue(client as never);
  return { calls };
}

function adminReviewService() {
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
        replied: false,
      },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// POST /api/google/reviews/[id]/reply — post an admin-approved reply to one
// review on Google, then flip the local row to replied. Admin-only. The reply
// text is required in the body: there is NO auto-post path (#608 AC3).
describe("POST /api/google/reviews/[id]/reply", () => {
  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    useService();
    const res = await POST(postReq({ comment: "Thanks!" }), params("rev-1"));
    expect(res.status).toBe(401);
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
    const res = await POST(postReq({ comment: "Thanks!" }), params("rev-1"));
    expect(res.status).toBe(403);
  });

  it("returns 400 and posts nothing when the comment is empty (no auto-post)", async () => {
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
          replied: false,
        },
      ],
    });

    const res = await POST(postReq({ comment: "   " }), params("rev-1"));

    expect(res.status).toBe(400);
    // The human-approval gate: an empty reply never reaches Google.
    expect(vi.mocked(getGoogleClient)).not.toHaveBeenCalled();
  });

  it("returns 404 and posts nothing for a review that belongs to another org", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "admin" }),
    });
    useService({
      google_review: [
        {
          id: "rev-1",
          organization_id: "org-2",
          google_review_id: "g-rev-1",
          location_name: "accounts/1/locations/2",
          replied: false,
        },
      ],
    });

    const res = await POST(postReq({ comment: "Thanks!" }), params("rev-1"));

    expect(res.status).toBe(404);
    expect(vi.mocked(getGoogleClient)).not.toHaveBeenCalled();
  });

  it("posts the approved reply to Google and flips local state (200)", async () => {
    adminReviewService();
    const { calls } = useGoogleClient({ updateTime: "2026-06-29T12:00:00Z" });

    const res = await POST(
      postReq({ comment: "Thanks for the kind words!" }),
      params("rev-1"),
    );

    expect(res.status).toBe(200);
    // Posted to Google: PUT .../reviews/g-rev-1/reply with the approved comment.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/accounts/1/locations/2/reviews/g-rev-1/reply");
    expect(calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      comment: "Thanks for the kind words!",
    });
    // The client was obtained over the privileged service client, org-scoped.
    expect(vi.mocked(getGoogleClient)).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
    );
    // Response reflects the now-replied state for the inbox to re-render from.
    const data = await res.json();
    expect(data.replied).toBe(true);
    expect(data.reply_comment).toBe("Thanks for the kind words!");
    expect(data.reply_updated_at).toBe("2026-06-29T12:00:00Z");
  });

  it("returns 502 when the Google account is not connected", async () => {
    adminReviewService();
    vi.mocked(getGoogleClient).mockResolvedValue(null);

    const res = await POST(postReq({ comment: "Thanks!" }), params("rev-1"));

    expect(res.status).toBe(502);
  });

  it("returns 502 and does not flip state when the Google post fails", async () => {
    adminReviewService();
    // Google rejects the reply (e.g. 403). postReviewReply throws.
    const { calls } = useGoogleClient({ status: 403 });

    const res = await POST(postReq({ comment: "Thanks!" }), params("rev-1"));

    expect(res.status).toBe(502);
    // The failure was surfaced, not swallowed: we attempted the post and the
    // response carries an error rather than a replied state.
    expect(calls).toHaveLength(1);
    const data = await res.json();
    expect(data.replied).toBeUndefined();
    expect(data.error).toBeTruthy();
  });
});
