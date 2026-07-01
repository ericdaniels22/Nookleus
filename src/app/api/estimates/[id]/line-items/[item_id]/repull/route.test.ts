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
import {
  fakeUserClient,
  memberTables,
} from "../../../../../__test-utils__/request-context-fakes";

const routeCtx = { params: Promise.resolve({ id: "est-1", item_id: "item-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

function useUser(opts: Parameters<typeof fakeUserClient>[0]) {
  const client = fakeUserClient(opts);
  vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);
  return client;
}

function repullRequest(body: unknown) {
  return new Request(
    "http://test/api/estimates/est-1/line-items/item-1/repull",
    { method: "POST", body: JSON.stringify(body) },
  );
}

// The frozen breadcrumb the line item was last pulled at: net wall area 100.
const FROZEN_SOURCE = {
  scope: "room",
  sketch_id: "sk-1",
  floor_id: "fl-1",
  room_id: "rm-1",
  room_name: "Living Room",
  kind: "wall_area_net",
  value: 100,
  pulled_at: "2026-06-01T00:00:00.000Z",
};

// A Job whose Sketch has one Floor with one Room, and a line item already frozen
// to that Room's net wall area (value 100). The Room's LIVE net_wall_area is now
// 125 — the Sketch was edited up since the pull — so a re-pull recomputes 100→125.
// unit_price 10 makes the frozen total easy to read. PostgREST returns numerics
// as strings, so the Room measurements are seeded as strings.
function seed(extra?: Record<string, unknown[]>) {
  return memberTables({
    userId: "user-1",
    role: "member",
    grants: ["edit_estimates"],
    extraTables: {
      estimates: [
        { id: "est-1", job_id: "job-1", deleted_at: null, updated_at: "2026-06-01T00:00:00Z" },
      ],
      estimate_line_items: [
        {
          id: "item-1",
          estimate_id: "est-1",
          section_id: "sec-1",
          quantity: 100,
          unit_price: 10,
          total: 1000,
          sketch_source: FROZEN_SOURCE,
        },
      ],
      sketches: [{ id: "sk-1", job_id: "job-1" }],
      floors: [{ id: "fl-1", sketch_id: "sk-1" }],
      rooms: [
        {
          id: "rm-1",
          floor_id: "fl-1",
          name: "Living Room",
          floor_area: "12",
          ceiling_area: "13",
          perimeter: "14",
          gross_wall_area: "112",
          net_wall_area: "125",
          volume: "96",
        },
      ],
      ...extra,
    },
  });
}

describe("POST /api/estimates/[id]/line-items/[item_id]/repull (#864)", () => {
  it("previews old-vs-new from the live Sketch without mutating", async () => {
    // Without `apply`, re-pull is a dry run: it re-reads the source Room's current
    // measurement and returns the frozen value beside it (#864 AC #2), writing
    // nothing. The user sees 100 → 125 before deciding.
    const client = useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await POST(repullRequest({}), routeCtx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      preview: { old_value: number; new_value: number; changed: boolean; kind: string; room_name: string };
    };
    expect(body.preview).toMatchObject({
      old_value: 100,
      new_value: 125,
      changed: true,
      kind: "wall_area_net",
      room_name: "Living Room",
    });
    // A preview never writes — the frozen quantity is untouched until confirmed.
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd).toBeUndefined();
  });

  it("previews the CURRENT quantity as old, even after a manual override", async () => {
    // The line was frozen at 100 but hand-edited to 250 since (a waste factor);
    // sketch_source.value still reads 100. The preview's old side must be the live
    // quantity (250), not the stale last-pulled 100 — so the confirmation shows the
    // real change (250 → 125) and never silently hides the discarded manual value.
    const client = useUser({
      user: { id: "user-1" },
      tables: seed({
        estimate_line_items: [
          {
            id: "item-1",
            estimate_id: "est-1",
            section_id: "sec-1",
            quantity: 250,
            unit_price: 10,
            total: 2500,
            sketch_source: FROZEN_SOURCE, // still records value: 100
          },
        ],
      }),
    });

    const res = await POST(repullRequest({}), routeCtx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      preview: { old_value: number; new_value: number; changed: boolean };
    };
    expect(body.preview).toMatchObject({ old_value: 250, new_value: 125, changed: true });
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd).toBeUndefined();
  });

  it("does not report a sub-cent measurement difference as changed (2-decimal billing)", async () => {
    // The Room's live net wall area is 250.567 (numeric(14,3)) but the quantity
    // column is numeric(10,2), so the pull stored 250.57. Re-pulling the unchanged
    // Sketch must report changed:false and a 250.57 new value — not a spurious
    // 250.57 → 250.567 diff that would nag the user to "refresh" an unchanged line.
    const client = useUser({
      user: { id: "user-1" },
      tables: seed({
        estimate_line_items: [
          {
            id: "item-1",
            estimate_id: "est-1",
            section_id: "sec-1",
            quantity: 250.57,
            unit_price: 10,
            total: 2505.7,
            sketch_source: FROZEN_SOURCE,
          },
        ],
        rooms: [
          {
            id: "rm-1",
            floor_id: "fl-1",
            name: "Living Room",
            floor_area: "12",
            ceiling_area: "13",
            perimeter: "14",
            gross_wall_area: "300",
            net_wall_area: "250.567",
            volume: "96",
          },
        ],
      }),
    });

    const res = await POST(repullRequest({}), routeCtx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      preview: { old_value: number; new_value: number; changed: boolean };
    };
    expect(body.preview).toMatchObject({ old_value: 250.57, new_value: 250.57, changed: false });
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd).toBeUndefined();
  });

  it("applies the re-pull: updates quantity, sketch_source, and total", async () => {
    // On confirm (`apply: true`) the refreshed value is frozen into quantity, the
    // sketch_source's value + pulled_at are refreshed (its Room identity/kind stay
    // frozen), and the total is recomputed (#864 AC #3). Net wall area 125 × 10 = 1250.
    const client = useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await POST(repullRequest({ apply: true }), routeCtx);

    expect(res.status).toBe(200);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd?.payload).toMatchObject({
      quantity: 125,
      total: 1250,
      sketch_source: {
        scope: "room",
        sketch_id: "sk-1",
        floor_id: "fl-1",
        room_id: "rm-1",
        room_name: "Living Room",
        kind: "wall_area_net",
        value: 125,
      },
    });
    // The re-pull is re-stamped with a fresh timestamp, later than the frozen one.
    const written = (upd?.payload as { sketch_source: { pulled_at: string } }).sketch_source;
    expect(typeof written.pulled_at).toBe("string");
    expect(written.pulled_at).not.toBe(FROZEN_SOURCE.pulled_at);
  });

  it("refuses to apply when the live value drifted from the confirmed preview (409, no write)", async () => {
    // The user confirmed a preview of new_value 8, but the Room's live net wall
    // area is now 125 (a concurrent Sketch edit between preview and confirm). The
    // apply must NOT silently freeze 125 — the estimator approved 8, not 125. It
    // refuses with a 409 so the change the user confirmed is the only one that can
    // land (#864 AC #2 — nothing changes silently).
    const client = useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await POST(
      repullRequest({ apply: true, expected_new_value: 8 }),
      routeCtx,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; preview?: { new_value: number } };
    expect(body.error).toMatch(/changed since/i);
    // The fresh value is offered back so the client can re-confirm.
    expect(body.preview?.new_value).toBe(125);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd).toBeUndefined();
  });

  it("applies when the confirmed value still matches the live measurement", async () => {
    // The happy path: the client echoes the confirmed new_value (125) and it still
    // matches the live measurement, so the apply proceeds and writes it.
    const client = useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await POST(
      repullRequest({ apply: true, expected_new_value: 125 }),
      routeCtx,
    );

    expect(res.status).toBe(200);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd?.payload).toMatchObject({ quantity: 125, total: 1250 });
  });

  it("fails cleanly when the source Room was deleted, leaving the quantity intact", async () => {
    // The line item is still frozen to rm-1, but the Room is gone (the Sketch was
    // edited to delete it). An apply must NOT write — the frozen quantity survives
    // a deleted source untouched (#864 AC #4). The response is a clear 409, not a
    // silent success or a NaN freeze.
    const client = useUser({
      user: { id: "user-1" },
      tables: seed({ rooms: [] }),
    });

    const res = await POST(repullRequest({ apply: true }), routeCtx);

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/no longer exists/i);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd).toBeUndefined();
  });

  it("previews a deleted source as a clean 409 without mutating", async () => {
    // The deleted-source guard fires on the preview path too, so the user is told
    // the source is gone the moment they try to re-pull — before any confirm.
    const client = useUser({
      user: { id: "user-1" },
      tables: seed({ rooms: [] }),
    });

    const res = await POST(repullRequest({}), routeCtx);

    expect(res.status).toBe(409);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd).toBeUndefined();
  });

  it("refuses to re-pull a hand-typed line item with no Sketch source (400)", async () => {
    // Re-pull only makes sense for a line whose quantity came from a Sketch. A
    // hand-typed row (sketch_source null) has nothing to refresh — refuse at the
    // door rather than resolving a Room from a null breadcrumb.
    const client = useUser({
      user: { id: "user-1" },
      tables: seed({
        estimate_line_items: [
          {
            id: "item-1",
            estimate_id: "est-1",
            section_id: "sec-1",
            quantity: 5,
            unit_price: 10,
            total: 50,
            sketch_source: null,
          },
        ],
      }),
    });

    const res = await POST(repullRequest({ apply: true }), routeCtx);

    expect(res.status).toBe(400);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd).toBeUndefined();
  });
});
