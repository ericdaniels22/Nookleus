// Route test for PATCH /api/invoices/[id]/layout (#485) — persisting a
// document's own PDF layout snapshot (ADR 0012). The route gates on
// edit_invoices, refuses a frozen (paid or voided) invoice, validates the body
// into a complete DocumentPdfLayout, and writes it to the `pdf_layout` column.
//
// The invoice twin of estimates/[id]/layout/route.test.ts: same withRequestContext
// route-test pattern (mock the server client + active-org resolver, drive the
// exported handler, assert status + recorded __mutations), with the invoice
// freeze boundary (paid/voided) rather than the estimate one (converted).

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

const routeCtx = { params: Promise.resolve({ id: "inv-1" }) };

// A complete DocumentPdfLayout — exactly what the panel sends: the effective
// look with one switch (show_markup) flipped off.
const COMPLETE_LAYOUT = {
  document_title: "Invoice",
  show_document_title: true,
  show_markup: false,
  show_overhead: false, // #576 — field default; part of the complete snapshot
  show_profit: false,
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
function bindUser(opts: Parameters<typeof fakeUserClient>[0]) {
  const client = fakeUserClient(opts);
  vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);
  return client;
}

function patchRequest(body: unknown) {
  return new Request("http://test/api/invoices/inv-1/layout", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// Build a member client granted edit_invoices, with one invoice row of the
// given status (the rest of the snapshot is irrelevant to the route).
function userWithInvoice(status: string, deleted_at: string | null = null) {
  return bindUser({
    user: { id: "user-1" },
    tables: memberTables({
      userId: "user-1",
      role: "member",
      grants: ["edit_invoices"],
      extraTables: {
        invoices: [{ id: "inv-1", status, deleted_at, pdf_layout: null }],
      },
    }),
  });
}

describe("PATCH /api/invoices/[id]/layout", () => {
  // The edit-document gate is enforced by withRequestContext; these guard that
  // this route is wired to it (#485: "gated by edit-document permission").
  it("returns 401 when unauthenticated", async () => {
    const client = bindUser({ user: null });
    const res = await PATCH(patchRequest(COMPLETE_LAYOUT), routeCtx);
    expect(res.status).toBe(401);
    expect(client.__mutations).toHaveLength(0);
  });

  it("returns 403 when the caller lacks edit_invoices", async () => {
    const client = bindUser({
      user: { id: "user-1" },
      tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
    });
    const res = await PATCH(patchRequest(COMPLETE_LAYOUT), routeCtx);
    expect(res.status).toBe(403);
    expect(client.__mutations).toHaveLength(0);
  });

  it("persists the complete layout snapshot onto the invoice's pdf_layout column", async () => {
    const client = userWithInvoice("draft");

    const res = await PATCH(patchRequest(COMPLETE_LAYOUT), routeCtx);

    expect(res.status).toBe(200);
    const update = client.__mutations.find(
      (m) => m.table === "invoices" && m.op === "update",
    );
    expect(update).toBeDefined();
    expect((update!.payload as { pdf_layout: unknown }).pdf_layout).toEqual(
      COMPLETE_LAYOUT,
    );
    // NB: the fake records a mutation at `.update()` time, before `.eq()` runs,
    // so __mutations proves the payload but NOT which row was targeted. The
    // per-document `.eq("id", id)` filter (the AC's "persists per-document") is
    // verified by reading the route source, not asserted here — the shared fake
    // can't observe a mass-update vs. a single-row update.
  });

  it("persists a layout on a sent-but-unpaid invoice (still editable)", async () => {
    const client = userWithInvoice("sent");

    const res = await PATCH(patchRequest(COMPLETE_LAYOUT), routeCtx);

    expect(res.status).toBe(200);
    expect(
      client.__mutations.find((m) => m.table === "invoices" && m.op === "update"),
    ).toBeDefined();
  });

  // The invoice freeze boundary (ADR 0007/0012) is paid OR voided — both lock.
  it.each(["paid", "voided"])(
    "refuses to persist a layout on a frozen (%s) invoice",
    async (status) => {
      const client = userWithInvoice(status);

      const res = await PATCH(patchRequest(COMPLETE_LAYOUT), routeCtx);

      expect(res.status).toBe(409);
      // Nothing was written — the frozen document keeps its look.
      const update = client.__mutations.find(
        (m) => m.table === "invoices" && m.op === "update",
      );
      expect(update).toBeUndefined();
    },
  );

  it("rejects a malformed (incomplete) layout payload without writing", async () => {
    const client = userWithInvoice("draft");

    // Missing the eight other boolean toggles — not a complete DocumentPdfLayout.
    const res = await PATCH(
      patchRequest({ document_title: "Invoice", show_document_title: true }),
      routeCtx,
    );

    expect(res.status).toBe(400);
    const update = client.__mutations.find(
      (m) => m.table === "invoices" && m.op === "update",
    );
    expect(update).toBeUndefined();
  });

  it("returns 404 for a missing invoice without writing", async () => {
    const client = bindUser({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["edit_invoices"],
        extraTables: { invoices: [] },
      }),
    });

    const res = await PATCH(patchRequest(COMPLETE_LAYOUT), routeCtx);

    expect(res.status).toBe(404);
    const update = client.__mutations.find(
      (m) => m.table === "invoices" && m.op === "update",
    );
    expect(update).toBeUndefined();
  });

  it("returns 404 for a trashed invoice without writing", async () => {
    const client = userWithInvoice("draft", "2026-01-01T00:00:00Z");

    const res = await PATCH(patchRequest(COMPLETE_LAYOUT), routeCtx);

    expect(res.status).toBe(404);
    const update = client.__mutations.find(
      (m) => m.table === "invoices" && m.op === "update",
    );
    expect(update).toBeUndefined();
  });

  // Trash wins over freeze: the route runs assertNotTrashed (404) BEFORE
  // isLayoutLocked (409), so a soft-deleted invoice that is *also* frozen must
  // still 404 — never 409. Pin that ordering so a future reorder (lock-first)
  // can't silently flip the code without a failing test.
  it("returns 404 for a trashed invoice even when frozen (trash wins over freeze)", async () => {
    const client = userWithInvoice("paid", "2026-01-01T00:00:00Z");

    const res = await PATCH(patchRequest(COMPLETE_LAYOUT), routeCtx);

    expect(res.status).toBe(404);
    const update = client.__mutations.find(
      (m) => m.table === "invoices" && m.op === "update",
    );
    expect(update).toBeUndefined();
  });
});
