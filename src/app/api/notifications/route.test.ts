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

import { GET, PATCH } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { fakeUserClient } from "../__test-utils__/request-context-fakes";
import { fakeNotificationsServiceClient } from "./__test-utils__/notifications-service-fake";

const noParams = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// #119 — the notifications route stays logged-in-only (notifications are
// per-user, not role-gated), but both handlers must derive the target user
// from the authenticated caller (`ctx.userId`), never from a client-supplied
// `userId` query param / `user_id` body field.

describe("GET /api/notifications — caller scoping (#119)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeNotificationsServiceClient() as never,
    );

    const res = await GET(
      new Request("http://test/api/notifications?userId=user-1"),
      noParams,
    );

    expect(res.status).toBe(401);
  });

  it("ignores a userId param pointing at another user and returns only the caller's notifications", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: { id: "user-1" } }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeNotificationsServiceClient({
        notifications: [
          { id: "n1", user_id: "user-1", is_read: false },
          { id: "n2", user_id: "user-2", is_read: false },
        ],
      }) as never,
    );

    const res = await GET(
      new Request("http://test/api/notifications?userId=user-2"),
      noParams,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notifications.map((n: { id: string }) => n.id)).toEqual(["n1"]);
  });

  it("counts only the caller's unread notifications", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: { id: "user-1" } }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeNotificationsServiceClient({
        notifications: [
          { id: "n1", user_id: "user-1", is_read: false },
          { id: "n2", user_id: "user-1", is_read: false },
          { id: "n3", user_id: "user-1", is_read: true },
          { id: "n4", user_id: "user-2", is_read: false },
        ],
      }) as never,
    );

    const res = await GET(
      new Request("http://test/api/notifications?userId=user-2"),
      noParams,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unread_count).toBe(2);
  });
});

function patch(body: unknown) {
  return new Request("http://test/api/notifications", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/notifications — caller scoping (#119)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeNotificationsServiceClient() as never,
    );

    const res = await PATCH(patch({ mark_all_read: true }), noParams);

    expect(res.status).toBe(401);
  });

  it("mark_all_read marks the caller's notifications, not the body user_id's", async () => {
    const notifications = [
      { id: "n1", user_id: "user-1", is_read: false },
      { id: "n2", user_id: "user-2", is_read: false },
    ];
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: { id: "user-1" } }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeNotificationsServiceClient({ notifications }) as never,
    );

    const res = await PATCH(
      patch({ mark_all_read: true, user_id: "user-2" }),
      noParams,
    );

    expect(res.status).toBe(200);
    expect(notifications.find((n) => n.id === "n1")!.is_read).toBe(true);
    expect(notifications.find((n) => n.id === "n2")!.is_read).toBe(false);
  });

  it("returns 404 and leaves the row unread for { id } of another user's notification", async () => {
    const notifications = [{ id: "n1", user_id: "user-2", is_read: false }];
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: { id: "user-1" } }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeNotificationsServiceClient({ notifications }) as never,
    );

    const res = await PATCH(patch({ id: "n1" }), noParams);

    expect(res.status).toBe(404);
    expect(notifications[0].is_read).toBe(false);
  });

  it("marks the caller's own notification read for { id }", async () => {
    const notifications = [{ id: "n1", user_id: "user-1", is_read: false }];
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: { id: "user-1" } }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeNotificationsServiceClient({ notifications }) as never,
    );

    const res = await PATCH(patch({ id: "n1" }), noParams);

    expect(res.status).toBe(200);
    expect(notifications[0].is_read).toBe(true);
  });
});
