import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { fakeUserClient, memberTables } from "../../../__test-utils__/request-context-fakes";

const routeCtx = { params: Promise.resolve({ id: "est-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

function useUser(opts: Parameters<typeof fakeUserClient>[0]) {
  const client = fakeUserClient(opts);
  vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);
  return client;
}

function postRequest(body: unknown) {
  return new Request("http://test/api/estimates/est-1/line-items", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function seed() {
  return memberTables({
    userId: "user-1",
    role: "member",
    grants: ["edit_estimates"],
    extraTables: {
      estimates: [{ id: "est-1", deleted_at: null, updated_at: "2026-06-01T00:00:00Z" }],
      estimate_sections: [{ id: "sec-1", estimate_id: "est-1" }],
      estimate_line_items: [],
    },
  });
}

describe("POST /api/estimates/[id]/line-items — line-item note (#382)", () => {
  it("persists a custom item's note onto the inserted row", async () => {
    const client = useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await POST(
      postRequest({
        section_id: "sec-1",
        description: "Replace shingles",
        quantity: 1,
        unit_price: 100,
        note: "Match existing shingle color",
      }),
      routeCtx,
    );

    expect(res.status).toBe(201);
    const insert = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "insert",
    );
    expect(insert?.payload).toMatchObject({ note: "Match existing shingle color" });
  });

  it("inserts note: null when the field is omitted", async () => {
    const client = useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await POST(
      postRequest({
        section_id: "sec-1",
        description: "Replace shingles",
        quantity: 1,
        unit_price: 100,
      }),
      routeCtx,
    );

    expect(res.status).toBe(201);
    const insert = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "insert",
    );
    expect(insert?.payload).toMatchObject({ note: null });
  });

  it("rejects a note longer than 2000 chars", async () => {
    useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await POST(
      postRequest({
        section_id: "sec-1",
        description: "Replace shingles",
        quantity: 1,
        unit_price: 100,
        note: "x".repeat(2001),
      }),
      routeCtx,
    );

    expect(res.status).toBe(400);
  });
});
