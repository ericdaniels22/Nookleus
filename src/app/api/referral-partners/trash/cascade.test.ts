// Cascade-on-hard-delete integration test for issue #256.
//
// The acceptance criterion (issue #256, "Integration test"):
//
//   "Soft-delete a partner with 2 call log entries and 3 contacts
//    (Primary, Owner, extra). After hard-delete:
//      - zero `referral_partner_calls` for that partner;
//      - all 3 contacts exist;
//      - `referral_partner_id` is NULL on each."
//
// The actual FK behaviour (referral_partner_calls ON DELETE CASCADE; contacts
// ON DELETE SET NULL) lives in the DB and is pinned by the SQL smoke tests
// `migration-build78-smoke-test.sql` §2d (general case) and
// `migration-build78b-trash-cascade-smoke-test.sql` (the specific 2-calls-+
// -3-contacts shape called out in the issue).
//
// This file pins the API-layer half of the contract: the Trash route's 30-day
// sweep (and the DELETE /api/referral-partners/[id] route the "Delete forever"
// button calls) MUST issue a single delete against `referral_partners`. It
// must NOT pre-emptively delete `referral_partner_calls` or `contacts` —
// doing so would either be redundant work or, worse, would take the contact
// rows down with the partner.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

import { GET } from "./route";
import { DELETE } from "../[id]/route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { memberTables } from "../../__test-utils__/request-context-fakes";

// A custom Supabase fake that records every (table, op) the route issues
// and simulates the DB-level FK cascade + SET NULL. The point of the test
// is to assert: the route hits `referral_partners.delete()` exactly once,
// and the simulated cascade leaves the AC's scenario in the documented
// final state.
type Row = Record<string, unknown>;

function makeRecordingDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const ops: { table: string; op: "delete" | "update"; ids: unknown[] }[] = [];

  function builder(table: string, rows: Row[]) {
    let filtered = [...rows];
    let pendingOp: "delete" | "update" | null = null;
    let pendingUpdate: Row | null = null;
    const api = {
      select() {
        return api;
      },
      update(payload: Row) {
        pendingOp = "update";
        pendingUpdate = payload;
        return api;
      },
      delete() {
        pendingOp = "delete";
        return api;
      },
      eq(col: string, val: unknown) {
        filtered = filtered.filter((r) => r[col] === val);
        return api;
      },
      in(col: string, vals: unknown[]) {
        filtered = filtered.filter((r) => vals.includes(r[col]));
        return api;
      },
      is() {
        return api;
      },
      not() {
        return api;
      },
      lt() {
        return api;
      },
      gt() {
        return api;
      },
      or() {
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      async maybeSingle() {
        return { data: filtered[0] ?? null, error: null };
      },
      async single() {
        return { data: filtered[0] ?? null, error: null };
      },
      then(resolve: (v: { data: Row[]; error: null }) => unknown) {
        return resolve({ data: filtered, error: null });
      },
    } as Record<string, unknown>;

    const realThen = api.then as (
      resolve: (v: { data: Row[]; error: null }) => unknown,
    ) => unknown;
    const flush = () => {
      if (pendingOp === "delete") {
        const ids = filtered.map((r) => r.id);
        ops.push({ table, op: "delete", ids });
        // Apply the DB's FK behaviour the same way Postgres would:
        //   referral_partners → referral_partner_calls cascade
        //                     → contacts.referral_partner_id SET NULL
        if (table === "referral_partners") {
          for (const id of ids) {
            tables.referral_partner_calls =
              tables.referral_partner_calls?.filter(
                (c) => c.referral_partner_id !== id,
              ) ?? [];
            tables.contacts = tables.contacts?.map((c) =>
              c.referral_partner_id === id
                ? { ...c, referral_partner_id: null }
                : c,
            ) ?? [];
          }
        }
        tables[table] = tables[table].filter((r) => !ids.includes(r.id));
        pendingOp = null;
      } else if (pendingOp === "update" && pendingUpdate) {
        const ids = filtered.map((r) => r.id);
        ops.push({ table, op: "update", ids });
        tables[table] = tables[table].map((r) =>
          ids.includes(r.id) ? { ...r, ...pendingUpdate } : r,
        );
        pendingOp = null;
        pendingUpdate = null;
      }
    };

    // Wrap maybeSingle / single / then to flush the pending op once the
    // query resolves — same shape as Supabase's awaited PostgrestBuilder.
    api.maybeSingle = async () => {
      const out = { data: filtered[0] ?? null, error: null as null };
      flush();
      return out;
    };
    api.single = async () => {
      const out = { data: filtered[0] ?? null, error: null as null };
      flush();
      return out;
    };
    api.then = (resolve: (v: { data: Row[]; error: null }) => unknown) => {
      const out = { data: filtered, error: null as null };
      flush();
      return realThen.call(api, () => resolve(out));
    };

    return api;
  }

  const client = {
    auth: {
      async getUser() {
        return { data: { user: { id: "user-1" } }, error: null };
      },
    },
    from(table: string) {
      return builder(table, tables[table] ?? []);
    },
    storage: {
      from() {
        return {
          async remove(paths: string[]) {
            return { data: paths.map((name) => ({ name })), error: null };
          },
        };
      },
    },
  };

  return { client, ops, tables };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

const SCENARIO = () => ({
  ...memberTables({ userId: "user-1", role: "admin" }),
  referral_partners: [
    {
      id: "p-1",
      organization_id: "org-1",
      company_name: "Acme Plumbing",
      // Trashed 31 days ago — past the 30-day window, so the sweep
      // should hard-delete it.
      deleted_at: new Date(
        Date.now() - 31 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    },
  ],
  referral_partner_calls: [
    {
      id: "c-1",
      organization_id: "org-1",
      referral_partner_id: "p-1",
      outcome: "voicemail",
    },
    {
      id: "c-2",
      organization_id: "org-1",
      referral_partner_id: "p-1",
      outcome: "spoke",
    },
  ],
  contacts: [
    {
      id: "primary",
      organization_id: "org-1",
      full_name: "Primary Contact",
      role: "referral_contact",
      referral_partner_id: "p-1",
    },
    {
      id: "owner",
      organization_id: "org-1",
      full_name: "Owner Contact",
      role: "referral_contact",
      referral_partner_id: "p-1",
    },
    {
      id: "extra",
      organization_id: "org-1",
      full_name: "Extra Contact",
      role: "referral_contact",
      referral_partner_id: "p-1",
    },
  ],
});

describe("cascade on hard-delete (issue #256 integration AC)", () => {
  it("the lazy 30-day sweep hard-deletes the partner — calls cascade, contacts survive with referral_partner_id NULL", async () => {
    const { client, ops, tables } = makeRecordingDb(SCENARIO());
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await GET(
      new Request("http://test/api/referral-partners/trash"),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);

    // The route issued exactly one delete against `referral_partners`.
    const deletes = ops.filter((o) => o.op === "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].table).toBe("referral_partners");
    expect(deletes[0].ids).toEqual(["p-1"]);

    // Simulated FK behaviour produced the AC's final state:
    //   - referral_partner_calls for that partner: 0
    //   - all 3 contacts exist
    //   - each contact's referral_partner_id is NULL
    expect(
      tables.referral_partner_calls.filter(
        (c) => c.referral_partner_id === "p-1",
      ),
    ).toHaveLength(0);
    expect(tables.contacts).toHaveLength(3);
    for (const c of tables.contacts) {
      expect(c.referral_partner_id).toBeNull();
    }
  });

  it("DELETE /api/referral-partners/[id] (the 'Delete forever' button) issues the same single delete", async () => {
    const { client, ops, tables } = makeRecordingDb(SCENARIO());
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await DELETE(
      new Request("http://test/api/referral-partners/p-1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "p-1" }) },
    );
    expect(res.status).toBe(200);

    // Exactly one delete, and it's against `referral_partners`. The route
    // does NOT pre-delete calls or contacts — the DB cascade does that.
    const deletes = ops.filter((o) => o.op === "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].table).toBe("referral_partners");

    expect(
      tables.referral_partner_calls.filter(
        (c) => c.referral_partner_id === "p-1",
      ),
    ).toHaveLength(0);
    expect(tables.contacts).toHaveLength(3);
    for (const c of tables.contacts) {
      expect(c.referral_partner_id).toBeNull();
    }
  });
});
