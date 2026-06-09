// Issue #572 — the Estimate PUT route accepts the split Overhead + Profit
// uplifts (AC3) and treats the legacy single Markup as write-dead (AC5).
//
// These tests drive the HTTP boundary: a PUT body carrying overhead/profit must
// reach the `estimates` field patch, the route must always recompute totals
// through the shared waterfall, and a stray legacy markup_type/markup_value in
// the body must be ignored. Harness mirrors the sibling status/route.test.ts —
// the route runs through withRequestContext, so we seed the User client with a
// member who holds edit_estimates and assert on recorded mutations.
//
// Fake-client note: recorded updates are NOT applied to the seeded rows, so
// recalculateTotals reads the SEEDED adjustment fields (not the body patch).
// That's why the recompute test seeds overhead/profit on the row and asserts on
// the recorded totals payload rather than on the route's returned estimate.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

import { PUT } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { fakeUserClient, memberTables } from "../../__test-utils__/request-context-fakes";

const routeCtx = { params: Promise.resolve({ id: "est-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

type EstimateRow = Record<string, unknown>;
type LineItemRow = Record<string, unknown>;

// Seed a member who holds edit_estimates, plus an `estimates` row and its
// line items. Adjustment fields default to none/0 so the recompute is a no-op
// unless a test overrides them.
function withEstimate(opts: {
  estimate?: EstimateRow;
  lineItems?: LineItemRow[];
} = {}) {
  const estimate: EstimateRow = {
    id: "est-1",
    organization_id: "org-1",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    subtotal: 0,
    overhead_type: "none",
    overhead_value: 0,
    profit_type: "none",
    profit_value: 0,
    markup_type: "none",
    markup_value: 0,
    discount_type: "none",
    discount_value: 0,
    tax_rate: 0,
    ...opts.estimate,
  };
  const client = fakeUserClient({
    user: { id: "user-1" },
    tables: memberTables({
      userId: "user-1",
      role: "member",
      grants: ["edit_estimates"],
      extraTables: {
        estimates: [estimate],
        estimate_sections: [],
        estimate_line_items: opts.lineItems ?? [],
      },
    }),
  });
  vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);
  return client;
}

function putRequest(body: unknown) {
  return new Request("http://test/api/estimates/est-1", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

// Recorded `estimates` update carrying the field patch (identified by the
// presence of an `overhead_type` key — the totals patch carries amounts, not
// type/value inputs).
function fieldPatch(client: ReturnType<typeof withEstimate>) {
  return client.__mutations.find(
    (m) =>
      m.table === "estimates" &&
      m.op === "update" &&
      (m.payload as Record<string, unknown>).overhead_type !== undefined,
  )?.payload as Record<string, unknown> | undefined;
}

// Recorded `estimates` update carrying the recomputed totals (identified by the
// presence of an `overhead_amount` key — written only by recalculateTotals).
function totalsPatch(client: ReturnType<typeof withEstimate>) {
  return client.__mutations.find(
    (m) =>
      m.table === "estimates" &&
      m.op === "update" &&
      (m.payload as Record<string, unknown>).overhead_amount !== undefined,
  )?.payload as Record<string, unknown> | undefined;
}

describe("PUT /api/estimates/[id] — Overhead & Profit (#572)", () => {
  it("accepts Overhead and Profit inputs and writes them to the estimate (AC3)", async () => {
    const client = withEstimate();
    const res = await PUT(
      putRequest({
        overhead_type: "percent",
        overhead_value: 10,
        profit_type: "percent",
        profit_value: 10,
      }),
      routeCtx,
    );
    expect(res.status).toBe(200);

    const patch = fieldPatch(client);
    expect(patch).toMatchObject({
      overhead_type: "percent",
      overhead_value: 10,
      profit_type: "percent",
      profit_value: 10,
    });
  });

  it("always recomputes totals through the shared waterfall (AC3)", async () => {
    // Overhead 10% + Profit 10% of a $1,000 raw subtotal → two $100 legs whose
    // sum is the $200 markup; no discount, no tax → $1,200 total. recalc reads
    // the SEEDED adjustment fields (the fake doesn't apply the body patch).
    const client = withEstimate({
      estimate: {
        overhead_type: "percent",
        overhead_value: 10,
        profit_type: "percent",
        profit_value: 10,
      },
      lineItems: [
        { id: "li-1", estimate_id: "est-1", quantity: 1, unit_price: 1000, total: 1000 },
      ],
    });
    const res = await PUT(putRequest({}), routeCtx);
    expect(res.status).toBe(200);

    expect(totalsPatch(client)).toMatchObject({
      subtotal: 1000,
      overhead_amount: 100,
      profit_amount: 100,
      markup_amount: 200,
      discount_amount: 0,
      adjusted_subtotal: 1200,
      tax_amount: 0,
      total: 1200,
    });
  });

  it("ignores legacy markup_type/markup_value in the body — write-dead (AC5)", async () => {
    const client = withEstimate();
    const res = await PUT(
      putRequest({
        overhead_type: "percent",
        overhead_value: 5,
        markup_type: "percent",
        markup_value: 99,
      }),
      routeCtx,
    );
    expect(res.status).toBe(200);

    const patch = fieldPatch(client);
    expect(patch).toMatchObject({ overhead_type: "percent", overhead_value: 5 });
    expect(patch).not.toHaveProperty("markup_type");
    expect(patch).not.toHaveProperty("markup_value");
  });
});
