import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock("@/lib/supabase-api", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/get-active-org", () => ({ getActiveOrganizationId: vi.fn() }));

import { GET, POST } from "./route";
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

const postReq = (body: unknown) =>
  new Request("http://test", { method: "POST", body: JSON.stringify(body) });

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
