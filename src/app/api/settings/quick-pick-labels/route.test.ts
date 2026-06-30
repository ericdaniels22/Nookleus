import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock("@/lib/supabase-api", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/get-active-org", () => ({ getActiveOrganizationId: vi.fn() }));

import { GET, POST, PUT, DELETE } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../__test-utils__/request-context-fakes";

const noParams = { params: Promise.resolve({}) };

// Mock the User client the wrapper authenticates against, returning the fake
// so the route body runs against seeded rows. Returns the client so a test can
// inspect recorded mutations (`__mutations`).
function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  const client = fakeUserClient(opts);
  vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);
  return client;
}

const lacks = () => ({
  user: { id: "u" },
  tables: memberTables({ userId: "u", role: "crew_member", grants: [] }),
});
const holds = () => ({
  user: { id: "u" },
  tables: memberTables({
    userId: "u",
    role: "crew_member",
    grants: ["access_settings"],
  }),
});
const admin = () => ({
  user: { id: "a" },
  tables: memberTables({ userId: "a", role: "admin", grants: [] }),
});
// A grant-holder whose active org owns the given quick_pick_labels rows, so a
// PUT/DELETE route body reads real seeded rows.
const holdsWith = (rows: Record<string, unknown>[]) => ({
  user: { id: "u" },
  tables: memberTables({
    userId: "u",
    role: "crew_member",
    grants: ["access_settings"],
    extraTables: { quick_pick_labels: rows },
  }),
});

const postReq = (body: unknown) =>
  new Request("http://test", { method: "POST", body: JSON.stringify(body) });
const putReq = (body: unknown) =>
  new Request("http://test", { method: "PUT", body: JSON.stringify(body) });
const delReq = (id?: string) =>
  new Request(id ? `http://test?id=${id}` : "http://test", { method: "DELETE" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// GET and POST mirror the damage-types catalog's access_settings gate (#819).
describe("GET /api/settings/quick-pick-labels — gated on access_settings", () => {
  it("401 unauthenticated", async () => {
    authed({ user: null });
    expect((await GET(new Request("http://test"), noParams)).status).toBe(401);
  });
  it("403 when the caller lacks access_settings", async () => {
    authed(lacks());
    expect((await GET(new Request("http://test"), noParams)).status).toBe(403);
  });
  it("lists labels when the caller holds access_settings", async () => {
    authed(holds());
    expect((await GET(new Request("http://test"), noParams)).status).toBe(200);
  });
  it("admins retain access without the key", async () => {
    authed(admin());
    expect((await GET(new Request("http://test"), noParams)).status).toBe(200);
  });
});

describe("POST /api/settings/quick-pick-labels — gated on access_settings", () => {
  it("401 unauthenticated", async () => {
    authed({ user: null });
    expect((await POST(postReq({ label: "x" }), noParams)).status).toBe(401);
  });
  it("403 when the caller lacks access_settings", async () => {
    authed(lacks());
    expect((await POST(postReq({ label: "x" }), noParams)).status).toBe(403);
  });
  it("allows the add when the caller holds access_settings", async () => {
    authed(holds());
    expect((await POST(postReq({ label: "x" }), noParams)).status).not.toBe(403);
  });
  it("admins retain access without the key", async () => {
    authed(admin());
    expect((await POST(postReq({ label: "x" }), noParams)).status).not.toBe(403);
  });
});

describe("POST /api/settings/quick-pick-labels — persistence", () => {
  it("persists the label org-scoped to the active org, never NULL", async () => {
    const client = authed(holds());
    await POST(postReq({ label: "Source of loss" }), noParams);
    const insert = client.__mutations.find(
      (m) => m.op === "insert" && m.table === "quick_pick_labels"
    );
    expect(insert).toBeTruthy();
    const payload = insert!.payload as { organization_id: string; label: string };
    expect(payload.organization_id).toBe("org-1");
    expect(payload.label).toBe("Source of loss");
  });

  it("rejects an empty / whitespace-only label with 400 and writes nothing", async () => {
    const client = authed(holds());
    const res = await POST(postReq({ label: "   " }), noParams);
    expect(res.status).toBe(400);
    expect(client.__mutations.some((m) => m.op === "insert")).toBe(false);
  });
});

// PUT edits one label (single object) or bulk-reorders the org's rows (array),
// gated on access_settings — mirroring the damage-types catalog (#820).
describe("PUT /api/settings/quick-pick-labels — gated on access_settings", () => {
  it("401 unauthenticated", async () => {
    authed({ user: null });
    expect((await PUT(putReq({}), noParams)).status).toBe(401);
  });
  it("403 when the caller lacks access_settings", async () => {
    authed(lacks());
    expect((await PUT(putReq({}), noParams)).status).toBe(403);
  });
  it("passes the gate when the caller holds access_settings", async () => {
    authed(holds());
    expect((await PUT(putReq({ label: "x" }), noParams)).status).not.toBe(403);
  });
  it("admins pass the gate without the key", async () => {
    authed(admin());
    expect((await PUT(putReq({ label: "x" }), noParams)).status).not.toBe(403);
  });
});

describe("PUT /api/settings/quick-pick-labels — single inline edit", () => {
  it("saves the new (trimmed) label text for one org-owned row", async () => {
    const client = authed(
      holdsWith([{ id: "ql-1", organization_id: "org-1", label: "Old", sort_order: 1 }]),
    );
    const res = await PUT(putReq({ id: "ql-1", label: "  Renamed  ", sort_order: 1 }), noParams);
    expect(res.status).toBe(200);
    const update = client.__mutations.find(
      (m) => m.op === "update" && m.table === "quick_pick_labels",
    );
    expect(update).toBeTruthy();
    expect((update!.payload as { label: string }).label).toBe("Renamed");
  });

  it("rejects a blank / whitespace-only edit with 400 and writes nothing", async () => {
    const client = authed(
      holdsWith([{ id: "ql-1", organization_id: "org-1", label: "Old", sort_order: 1 }]),
    );
    const res = await PUT(putReq({ id: "ql-1", label: "   " }), noParams);
    expect(res.status).toBe(400);
    expect(client.__mutations.some((m) => m.op === "update")).toBe(false);
  });
});

describe("PUT /api/settings/quick-pick-labels — bulk reorder (array)", () => {
  it("persists the new sort_order for each org row", async () => {
    const client = authed(
      holdsWith([
        { id: "ql-1", organization_id: "org-1", label: "A", sort_order: 1 },
        { id: "ql-2", organization_id: "org-1", label: "B", sort_order: 2 },
      ]),
    );
    const res = await PUT(
      putReq([
        { id: "ql-2", label: "B", sort_order: 1 },
        { id: "ql-1", label: "A", sort_order: 2 },
      ]),
      noParams,
    );
    expect(res.status).toBe(200);
    const updates = client.__mutations.filter(
      (m) => m.op === "update" && m.table === "quick_pick_labels",
    );
    expect(updates).toHaveLength(2);
    expect(updates.map((u) => (u.payload as { sort_order: number }).sort_order)).toEqual([1, 2]);
  });
});

// DELETE removes an org-owned label but protects the shared NULL-org defaults,
// gated on access_settings — mirroring the damage-types catalog (#820).
describe("DELETE /api/settings/quick-pick-labels — gated on access_settings", () => {
  it("401 unauthenticated", async () => {
    authed({ user: null });
    expect((await DELETE(delReq("ql-1"), noParams)).status).toBe(401);
  });
  it("403 when the caller lacks access_settings", async () => {
    authed(lacks());
    expect((await DELETE(delReq("ql-1"), noParams)).status).toBe(403);
  });
  it("passes the gate when the caller holds access_settings", async () => {
    authed(holds());
    expect((await DELETE(delReq(), noParams)).status).not.toBe(403);
  });
  it("admins pass the gate without the key", async () => {
    authed(admin());
    expect((await DELETE(delReq(), noParams)).status).not.toBe(403);
  });
});

describe("DELETE /api/settings/quick-pick-labels — default protection & removal", () => {
  it("blocks deleting a built-in NULL-org default with 403, leaving it intact", async () => {
    const client = authed(
      holdsWith([
        { id: "ql-default", organization_id: null, label: "Source of loss", sort_order: 1 },
      ]),
    );
    const res = await DELETE(delReq("ql-default"), noParams);
    expect(res.status).toBe(403);
    expect(client.__mutations.some((m) => m.op === "delete")).toBe(false);
  });

  it("removes an org-owned label", async () => {
    const client = authed(
      holdsWith([{ id: "ql-1", organization_id: "org-1", label: "Mine", sort_order: 1 }]),
    );
    const res = await DELETE(delReq("ql-1"), noParams);
    expect(res.status).toBe(200);
    expect(
      client.__mutations.some((m) => m.op === "delete" && m.table === "quick_pick_labels"),
    ).toBe(true);
  });
});
