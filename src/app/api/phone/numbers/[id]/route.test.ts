// PRD #304 — Nookleus Phone. Slice 8 (#312) — configure a Shared number's
// inbound rule.
//
// PATCH /api/phone/numbers/[id]
// The Settings → Phone editor saves a Shared number's answer rule here.
// Admin-only (canManage, ADR 0003). The body's `inbound_rule` is run
// through the parseInboundRule trust boundary before it touches the jsonb
// column, so only the four routable shapes are ever persisted.
//
// Inbound rules are a Shared-number concept (ADR 0005/0006) — Personal
// numbers always go to voicemail and never reach decideShared, so
// PATCHing one is a 409.
//
// The test runs the REAL withRequestContext (mocking only the Supabase
// client factories + active-org), so the wrapper's auth/permission gate is
// exercised end-to-end. The Service client is a local recorder so the
// persisted patch can be asserted.

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
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "@/app/api/email/__test-utils__/request-context-fakes";

type Row = Record<string, unknown>;

// A Service-client recorder: the shared fakeServiceClient passes `update`
// through and returns the unchanged seeded row, so it can't prove what was
// written. This records the patch + filters and returns the merged row.
function makeServiceClient(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = { phone_numbers: [], ...seed };
  const updates: { table: string; patch: Row; filters: Row }[] = [];

  function builder(table: string) {
    let rows = tables[table] ?? [];
    const ctx: { filters: Row } = { filters: {} };
    let pendingUpdate: Row | null = null;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      ctx.filters[col] = val;
      rows = rows.filter((r) => r[col] === val);
      return b;
    };
    b.update = (patch: Row) => {
      pendingUpdate = patch;
      return b;
    };
    b.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    b.single = async () => {
      if (pendingUpdate) {
        updates.push({
          table,
          patch: pendingUpdate,
          filters: { ...ctx.filters },
        });
        return { data: { ...(rows[0] ?? {}), ...pendingUpdate }, error: null };
      }
      return {
        data: rows[0] ?? null,
        error: rows[0] ? null : { message: "no rows" },
      };
    };
    return b;
  }

  return { client: { from: builder }, tables, updates };
}

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

const adminTables = memberTables({ userId: "admin-1", role: "admin", grants: [] });

const SHARED_ROW = {
  id: "pn-1",
  organization_id: "org-1",
  kind: "shared" as const,
  user_id: null,
  inbound_rule: null,
};

function patchReq(body: unknown): Request {
  return new Request("http://test/api/phone/numbers/pn-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("PATCH /api/phone/numbers/[id] — saves a Shared number's rule (tracer)", () => {
  it("admin saves a ring-all rule: validated, persisted to inbound_rule, returns the row", async () => {
    authed({ user: { id: "admin-1" }, tables: adminTables });
    const { client, updates } = makeServiceClient({ phone_numbers: [SHARED_ROW] });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await PATCH(
      patchReq({ inbound_rule: { kind: "ring-all", users: ["u1", "u2"] } }),
      idParams("pn-1"),
    );

    expect(res.status).toBe(200);
    const upd = updates.find((u) => u.table === "phone_numbers");
    expect(upd).toBeDefined();
    expect(upd!.filters).toMatchObject({ id: "pn-1" });
    expect(upd!.patch.inbound_rule).toEqual({
      kind: "ring-all",
      users: ["u1", "u2"],
    });

    const json = await res.json();
    expect(json.inbound_rule).toEqual({ kind: "ring-all", users: ["u1", "u2"] });
  });

  it("persists a round-robin rule's sequence verbatim", async () => {
    authed({ user: { id: "admin-1" }, tables: adminTables });
    const { client, updates } = makeServiceClient({ phone_numbers: [SHARED_ROW] });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await PATCH(
      patchReq({
        inbound_rule: { kind: "round-robin", sequence: ["u3", "u1"] },
      }),
      idParams("pn-1"),
    );

    expect(res.status).toBe(200);
    const upd = updates.find((u) => u.table === "phone_numbers");
    expect(upd!.patch.inbound_rule).toEqual({
      kind: "round-robin",
      sequence: ["u3", "u1"],
    });
  });

  it("persists a voicemail rule (admin can switch a number back to voicemail)", async () => {
    authed({ user: { id: "admin-1" }, tables: adminTables });
    const { client, updates } = makeServiceClient({
      phone_numbers: [
        { ...SHARED_ROW, inbound_rule: { kind: "ring-all", users: ["u1"] } },
      ],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await PATCH(
      patchReq({ inbound_rule: { kind: "voicemail" } }),
      idParams("pn-1"),
    );

    expect(res.status).toBe(200);
    const upd = updates.find((u) => u.table === "phone_numbers");
    expect(upd!.patch.inbound_rule).toEqual({ kind: "voicemail" });
  });
});

describe("PATCH /api/phone/numbers/[id] — auth + permission gate", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });
    const { client, updates } = makeServiceClient({ phone_numbers: [SHARED_ROW] });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await PATCH(
      patchReq({ inbound_rule: { kind: "voicemail" } }),
      idParams("pn-1"),
    );

    expect(res.status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it("returns 403 when the caller is not an admin", async () => {
    authed({
      user: { id: "crew-1" },
      tables: memberTables({
        userId: "crew-1",
        role: "crew_lead",
        grants: ["view_phone"],
      }),
    });
    const { client, updates } = makeServiceClient({ phone_numbers: [SHARED_ROW] });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await PATCH(
      patchReq({ inbound_rule: { kind: "voicemail" } }),
      idParams("pn-1"),
    );

    expect(res.status).toBe(403);
    expect(updates).toHaveLength(0);
  });
});

describe("PATCH /api/phone/numbers/[id] — not found / cross-org", () => {
  it("returns 404 when the number does not exist", async () => {
    authed({ user: { id: "admin-1" }, tables: adminTables });
    const { client } = makeServiceClient({ phone_numbers: [] });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await PATCH(
      patchReq({ inbound_rule: { kind: "voicemail" } }),
      idParams("missing"),
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 when the number belongs to another organization", async () => {
    authed({ user: { id: "admin-1" }, tables: adminTables });
    const { client, updates } = makeServiceClient({
      phone_numbers: [{ ...SHARED_ROW, organization_id: "org-other" }],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await PATCH(
      patchReq({ inbound_rule: { kind: "voicemail" } }),
      idParams("pn-1"),
    );

    expect(res.status).toBe(404);
    expect(updates).toHaveLength(0);
  });
});

describe("PATCH /api/phone/numbers/[id] — Shared-only + body validation", () => {
  it("returns 409 when the number is Personal (inbound rule not configurable)", async () => {
    authed({ user: { id: "admin-1" }, tables: adminTables });
    const { client, updates } = makeServiceClient({
      phone_numbers: [
        { ...SHARED_ROW, kind: "personal", user_id: "owner-1" },
      ],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await PATCH(
      patchReq({ inbound_rule: { kind: "ring-all", users: ["u1"] } }),
      idParams("pn-1"),
    );

    expect(res.status).toBe(409);
    expect(updates).toHaveLength(0);
  });

  it("returns 400 when inbound_rule is a malformed shape", async () => {
    authed({ user: { id: "admin-1" }, tables: adminTables });
    const { client, updates } = makeServiceClient({ phone_numbers: [SHARED_ROW] });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await PATCH(
      patchReq({ inbound_rule: { kind: "page-everyone" } }),
      idParams("pn-1"),
    );

    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  it("returns 400 when inbound_rule is missing from the body", async () => {
    authed({ user: { id: "admin-1" }, tables: adminTables });
    const { client, updates } = makeServiceClient({ phone_numbers: [SHARED_ROW] });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const res = await PATCH(patchReq({}), idParams("pn-1"));

    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });
});
