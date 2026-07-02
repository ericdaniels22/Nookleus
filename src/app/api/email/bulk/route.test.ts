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

import { PATCH } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../__test-utils__/request-context-fakes";

const noParams = { params: Promise.resolve({}) };

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

function patchReq(body: Record<string, unknown> = {}) {
  return new Request("http://test", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("PATCH /api/email/bulk — gated on send_email (#105)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });

    const res = await PATCH(patchReq(), noParams);

    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller holds only view_email", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_member",
        grants: ["view_email"],
      }),
    });

    const res = await PATCH(patchReq(), noParams);

    expect(res.status).toBe(403);
  });

  it("bulk-updates emails when the caller holds send_email", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_member",
        grants: ["send_email"],
      }),
    });

    const res = await PATCH(
      patchReq({ ids: ["e-1", "e-2"], action: "mark_read" }),
      noParams,
    );

    expect(res.status).toBe(200);
  });

  it("admins pass the gate without holding the key", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });

    const res = await PATCH(
      patchReq({ ids: ["e-1"], action: "mark_read" }),
      noParams,
    );

    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/email/bulk — move action (#957)", () => {
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];

  function authedWithWrites(grants: string[]) {
    writes.length = 0;
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "crew_member", grants }),
        onWrite: (table, op, payload) => writes.push({ table, op, payload }),
      }) as never,
    );
  }

  it("moves emails into the target bucket and locks them so nothing snaps back", async () => {
    authedWithWrites(["send_email"]);

    const res = await PATCH(
      patchReq({ ids: ["e-1", "e-2"], action: "move", category: "promotions" }),
      noParams,
    );

    expect(res.status).toBe(200);
    const emailWrite = writes.find((w) => w.table === "emails" && w.op === "update");
    expect(emailWrite?.payload).toEqual({ category: "promotions", category_locked: true });
  });

  it("moves into Jobs like any other bucket", async () => {
    authedWithWrites(["send_email"]);

    const res = await PATCH(
      patchReq({ ids: ["e-1"], action: "move", category: "jobs" }),
      noParams,
    );

    expect(res.status).toBe(200);
    const emailWrite = writes.find((w) => w.table === "emails" && w.op === "update");
    expect(emailWrite?.payload).toEqual({ category: "jobs", category_locked: true });
  });

  it("rejects a view-only pseudo-bucket as a move target", async () => {
    authedWithWrites(["send_email"]);

    const res = await PATCH(
      patchReq({ ids: ["e-1"], action: "move", category: "starred" }),
      noParams,
    );

    expect(res.status).toBe(400);
  });
});
