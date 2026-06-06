// Route test for PATCH /api/estimates/[id]/layout (#483) — persisting a
// document's own PDF layout snapshot (ADR 0012). The route gates on
// edit_estimates, refuses a frozen (converted) estimate, validates the body
// into a complete DocumentPdfLayout, and writes it to the `pdf_layout` column.
//
// Mirrors the withRequestContext route-test pattern from
// estimates/[id]/status/route.test.ts: mock the server client + active-org
// resolver, drive the exported handler, assert status + recorded __mutations.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
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
} from "../../../__test-utils__/request-context-fakes";

const routeCtx = { params: Promise.resolve({ id: "est-1" }) };

// A complete DocumentPdfLayout — exactly what the panel sends: the effective
// look with one switch (show_markup) flipped off.
const COMPLETE_LAYOUT = {
  document_title: "Estimate",
  show_document_title: true,
  show_markup: false,
  show_discount: true,
  show_tax: true,
  show_opening_statement: true,
  show_closing_statement: true,
  show_category_subtotals: false,
  show_code_column: true,
  show_item_notes: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// Bind a fake User client and hand it back so the test can read __mutations.
function useUser(opts: Parameters<typeof fakeUserClient>[0]) {
  const client = fakeUserClient(opts);
  vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);
  return client;
}

function patchRequest(body: unknown) {
  return new Request("http://test/api/estimates/est-1/layout", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/estimates/[id]/layout", () => {
  // The edit-document gate is enforced by withRequestContext; these guard that
  // this route is wired to it (#483: "gated by edit-document permission").
  it("returns 401 when unauthenticated", async () => {
    const client = useUser({ user: null });
    const res = await PATCH(patchRequest(COMPLETE_LAYOUT), routeCtx);
    expect(res.status).toBe(401);
    expect(client.__mutations).toHaveLength(0);
  });

  it("returns 403 when the caller lacks edit_estimates", async () => {
    const client = useUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
    });
    const res = await PATCH(patchRequest(COMPLETE_LAYOUT), routeCtx);
    expect(res.status).toBe(403);
    expect(client.__mutations).toHaveLength(0);
  });

  it("persists the complete layout snapshot onto the estimate's pdf_layout column", async () => {
    const client = useUser({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["edit_estimates"],
        extraTables: {
          estimates: [
            { id: "est-1", status: "draft", deleted_at: null, pdf_layout: null },
          ],
        },
      }),
    });

    const res = await PATCH(patchRequest(COMPLETE_LAYOUT), routeCtx);

    expect(res.status).toBe(200);
    const update = client.__mutations.find(
      (m) => m.table === "estimates" && m.op === "update",
    );
    expect(update).toBeDefined();
    expect((update!.payload as { pdf_layout: unknown }).pdf_layout).toEqual(
      COMPLETE_LAYOUT,
    );
  });

  it("refuses to persist a layout on a frozen (converted) estimate", async () => {
    const client = useUser({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["edit_estimates"],
        extraTables: {
          estimates: [
            { id: "est-1", status: "converted", deleted_at: null, pdf_layout: null },
          ],
        },
      }),
    });

    const res = await PATCH(patchRequest(COMPLETE_LAYOUT), routeCtx);

    expect(res.status).toBe(409);
    // Nothing was written — the frozen document keeps its look.
    const update = client.__mutations.find(
      (m) => m.table === "estimates" && m.op === "update",
    );
    expect(update).toBeUndefined();
  });

  it("rejects a malformed (incomplete) layout payload without writing", async () => {
    const client = useUser({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["edit_estimates"],
        extraTables: {
          estimates: [
            { id: "est-1", status: "draft", deleted_at: null, pdf_layout: null },
          ],
        },
      }),
    });

    // Missing the eight other boolean toggles — not a complete DocumentPdfLayout.
    const res = await PATCH(
      patchRequest({ document_title: "Estimate", show_document_title: true }),
      routeCtx,
    );

    expect(res.status).toBe(400);
    const update = client.__mutations.find(
      (m) => m.table === "estimates" && m.op === "update",
    );
    expect(update).toBeUndefined();
  });

  it("returns 404 for a missing estimate without writing", async () => {
    const client = useUser({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["edit_estimates"],
        extraTables: { estimates: [] },
      }),
    });

    const res = await PATCH(patchRequest(COMPLETE_LAYOUT), routeCtx);

    expect(res.status).toBe(404);
    const update = client.__mutations.find(
      (m) => m.table === "estimates" && m.op === "update",
    );
    expect(update).toBeUndefined();
  });

  it("returns 404 for a trashed estimate without writing", async () => {
    const client = useUser({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["edit_estimates"],
        extraTables: {
          estimates: [
            {
              id: "est-1",
              status: "draft",
              deleted_at: "2026-01-01T00:00:00Z",
              pdf_layout: null,
            },
          ],
        },
      }),
    });

    const res = await PATCH(patchRequest(COMPLETE_LAYOUT), routeCtx);

    expect(res.status).toBe(404);
    const update = client.__mutations.find(
      (m) => m.table === "estimates" && m.op === "update",
    );
    expect(update).toBeUndefined();
  });
});
