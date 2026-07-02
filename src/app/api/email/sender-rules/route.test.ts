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

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../__test-utils__/request-context-fakes";

type Row = Record<string, unknown>;
const noParams = { params: Promise.resolve({}) };

let writes: Array<{ table: string; op: string; payload: Row | Row[] }> = [];

function authed(opts: {
  user: { id: string } | null;
  grants?: string[];
  role?: string;
  extraTables?: Record<string, Row[]>;
}) {
  writes = [];
  const tables = {
    ...(opts.user
      ? memberTables({
          userId: opts.user.id,
          role: opts.role ?? "crew_member",
          grants: opts.grants ?? [],
        })
      : {}),
    ...(opts.extraTables ?? {}),
  };
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient({
      user: opts.user,
      tables,
      onWrite: (table, op, payload) => writes.push({ table, op, payload }),
    }) as never,
  );
}

function postReq(body: Record<string, unknown> = {}) {
  return new Request("http://test", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("POST /api/email/sender-rules — create a Sender rule + re-file (#957)", () => {
  it("creates the rule and re-files the sender's movable inbox mail only", async () => {
    authed({
      user: { id: "user-1" },
      grants: ["send_email"],
      extraTables: {
        category_rules: [],
        emails: [
          // movable: unlocked, different bucket
          { id: "e-1", from_address: "Sender@X.com", folder: "inbox", category: "general", category_locked: false, organization_id: "org-1" },
          // already in the target bucket → no-op
          { id: "e-2", from_address: "sender@x.com", folder: "inbox", category: "promotions", category_locked: false, organization_id: "org-1" },
          // manually moved elsewhere → locked, must never snap back
          { id: "e-3", from_address: "sender@x.com", folder: "inbox", category: "general", category_locked: true, organization_id: "org-1" },
          // a different sender → untouched
          { id: "e-4", from_address: "other@y.com", folder: "inbox", category: "general", category_locked: false, organization_id: "org-1" },
        ],
      },
    });

    const res = await POST(
      postReq({ fromAddress: "sender@x.com", category: "promotions" }),
      noParams,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.refiled).toBe(1);

    const ruleInsert = writes.find((w) => w.table === "category_rules" && w.op === "insert");
    expect(ruleInsert?.payload).toEqual({
      match_type: "sender_address",
      match_value: "sender@x.com",
      category: "promotions",
      organization_id: "org-1",
      is_active: true,
    });

    const emailUpdate = writes.find((w) => w.table === "emails" && w.op === "update");
    expect(emailUpdate?.payload).toEqual({ category: "promotions" });
  });

  it("updates an existing Sender rule instead of inserting a duplicate — the latest move wins", async () => {
    authed({
      user: { id: "user-1" },
      grants: ["send_email"],
      extraTables: {
        category_rules: [
          {
            id: "r-1",
            match_type: "sender_address",
            match_value: "sender@x.com",
            category: "promotions",
            is_active: true,
            organization_id: "org-1",
          },
        ],
        emails: [],
      },
    });

    const res = await POST(
      postReq({ fromAddress: "sender@x.com", category: "social" }),
      noParams,
    );

    expect(res.status).toBe(200);
    expect(writes.find((w) => w.table === "category_rules" && w.op === "insert")).toBeUndefined();
    const ruleUpdate = writes.find((w) => w.table === "category_rules" && w.op === "update");
    expect(ruleUpdate?.payload).toEqual({ category: "social", is_active: true });
  });

  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });
    const res = await POST(postReq({ fromAddress: "a@b.com", category: "general" }), noParams);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller holds only view_email", async () => {
    authed({ user: { id: "user-1" }, grants: ["view_email"] });
    const res = await POST(postReq({ fromAddress: "a@b.com", category: "general" }), noParams);
    expect(res.status).toBe(403);
  });

  it("rejects a missing fromAddress", async () => {
    authed({ user: { id: "user-1" }, grants: ["send_email"], extraTables: { category_rules: [], emails: [] } });
    const res = await POST(postReq({ category: "general" }), noParams);
    expect(res.status).toBe(400);
  });

  it("rejects a view-only pseudo-bucket as the target", async () => {
    authed({ user: { id: "user-1" }, grants: ["send_email"], extraTables: { category_rules: [], emails: [] } });
    const res = await POST(postReq({ fromAddress: "a@b.com", category: "all" }), noParams);
    expect(res.status).toBe(400);
  });
});
