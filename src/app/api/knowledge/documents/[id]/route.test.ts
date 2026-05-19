import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));

// A minimal Service client for the route bodies. The wrapper's allow/deny
// runs before the handler, so this only needs to cover the surface the GET
// and DELETE bodies touch: a chainable query builder (`select`/`delete`/`eq`
// thenable for the delete, `single` for the reads) and the storage `remove`.
function fakeKnowledgeServiceClient(doc: Record<string, unknown> | null) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    delete: () => builder,
    eq: () => builder,
    single: async () => ({
      data: doc,
      error: doc ? null : { message: "not found" },
    }),
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: [], error: null }),
  };
  return {
    from: () => builder,
    storage: {
      from: () => ({ remove: async () => ({ data: [], error: null }) }),
    },
  };
}
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

import { DELETE, GET } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../../settings/__test-utils__/request-context-fakes";

const idParams = { params: Promise.resolve({ id: "doc-1" }) };

function authed(opts: Parameters<typeof fakeUserClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient(opts) as never,
  );
}

function deleteReq() {
  return new Request("http://test/api/knowledge/documents/doc-1", {
    method: "DELETE",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// #121 — the knowledge base is product-level global content (no
// organization_id). DELETE cascades chunks and removes the storage file
// for every org, so it is restricted to an admin-class caller; the rule
// was logged-in-only before this slice.
describe("DELETE /api/knowledge/documents/[id] — gated on adminOnly (#121)", () => {
  it("returns 403 for a non-admin caller", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_member",
        grants: [],
      }),
    });

    const res = await DELETE(deleteReq(), idParams);

    expect(res.status).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });

    const res = await DELETE(deleteReq(), idParams);

    expect(res.status).toBe(401);
  });

  it("lets an admin through the gate and deletes the document", async () => {
    authed({
      user: { id: "admin-1" },
      tables: memberTables({ userId: "admin-1", role: "admin", grants: [] }),
    });
    vi.mocked(createServiceClient).mockReturnValue(
      fakeKnowledgeServiceClient({ id: "doc-1", file_path: "iicrc/s500.pdf" }) as never,
    );

    const res = await DELETE(deleteReq(), idParams);

    expect(res.status).toBe(200);
  });
});

function getReq() {
  return new Request("http://test/api/knowledge/documents/doc-1");
}

// #121 leaves the read path alone — the global knowledge base is meant to
// be readable by any logged-in user.
describe("GET /api/knowledge/documents/[id] — unchanged, logged-in only (#121)", () => {
  it("returns 401 when unauthenticated", async () => {
    authed({ user: null });

    const res = await GET(getReq(), idParams);

    expect(res.status).toBe(401);
  });

  it("lets a non-admin member read a document", async () => {
    authed({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "crew_member",
        grants: [],
      }),
    });
    vi.mocked(createServiceClient).mockReturnValue(
      fakeKnowledgeServiceClient({ id: "doc-1", standard_id: "iicrc-s500" }) as never,
    );

    const res = await GET(getReq(), idParams);

    expect(res.status).toBe(200);
  });
});
