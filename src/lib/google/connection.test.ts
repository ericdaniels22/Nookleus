import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveConnectionState,
  toConnectionSummary,
  getGoogleConnection,
  markBroken,
  deleteConnection,
} from "./connection";
import type { GoogleConnectionRow } from "./types";

// #615 — the connection's public shape is derived purely from its row. A missing
// row is "disconnected" (disconnect deletes the row, so absence IS the state);
// a present row reports its stored status; and the summary never leaks tokens.

function makeRow(overrides: Partial<GoogleConnectionRow> = {}): GoogleConnectionRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    organization_id: "22222222-2222-4222-8222-222222222222",
    google_account_email: "owner@aaadisasterrecovery.com",
    google_account_name: "AAA Disaster Recovery",
    refresh_token_encrypted: "iv:tag:cipher",
    access_token_encrypted: "iv:tag:cipher",
    access_token_expires_at: "2026-06-27T12:00:00.000Z",
    scopes: ["openid", "https://www.googleapis.com/auth/business.manage"],
    status: "connected",
    broken_reason: null,
    broken_at: null,
    connected_by: "33333333-3333-4333-8333-333333333333",
    created_at: "2026-06-27T11:00:00.000Z",
    updated_at: "2026-06-27T11:00:00.000Z",
    ...overrides,
  };
}

describe("deriveConnectionState", () => {
  it("reports disconnected when there is no row", () => {
    expect(deriveConnectionState(null)).toBe("disconnected");
  });

  it("reports connected for a connected row", () => {
    expect(deriveConnectionState(makeRow({ status: "connected" }))).toBe("connected");
  });

  it("reports broken for a broken row", () => {
    expect(deriveConnectionState(makeRow({ status: "broken" }))).toBe("broken");
  });
});

describe("toConnectionSummary", () => {
  it("summarises a missing row as disconnected with no account", () => {
    expect(toConnectionSummary(null)).toEqual({
      state: "disconnected",
      account_email: null,
      account_name: null,
      scopes: [],
      broken_reason: null,
      connected_at: null,
    });
  });

  it("summarises a connected row without exposing any token material", () => {
    const summary = toConnectionSummary(
      makeRow({ created_at: "2026-06-01T09:00:00.000Z" }),
    );
    expect(summary).toEqual({
      state: "connected",
      account_email: "owner@aaadisasterrecovery.com",
      account_name: "AAA Disaster Recovery",
      scopes: ["openid", "https://www.googleapis.com/auth/business.manage"],
      broken_reason: null,
      connected_at: "2026-06-01T09:00:00.000Z",
    });
    // The summary type has no token fields; assert the shape carries none.
    expect(JSON.stringify(summary)).not.toContain("cipher");
  });

  it("carries the broken reason through for the reconnect prompt", () => {
    const summary = toConnectionSummary(
      makeRow({ status: "broken", broken_reason: "invalid_grant" }),
    );
    expect(summary.state).toBe("broken");
    expect(summary.broken_reason).toBe("invalid_grant");
  });
});

// ---------------------------------------------------------------------------
// In-memory google_connection fake. Models just the chain the store uses:
//   select("*").eq("organization_id", x).maybeSingle()
//   update({...}).eq("id", x)
//   delete().eq("organization_id", x)
// `eq` is recorded so a test can prove the store scopes by the column it claims.
// ---------------------------------------------------------------------------
function makeFakeDb(rows: GoogleConnectionRow[]) {
  function from(table: string) {
    if (table !== "google_connection") throw new Error(`unexpected table: ${table}`);
    return {
      select() {
        const filters: Array<[string, unknown]> = [];
        const api = {
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            return api;
          },
          async maybeSingle<T>() {
            const match = rows.find((r) =>
              filters.every(([col, val]) => (r as unknown as Record<string, unknown>)[col] === val),
            );
            return { data: (match as T) ?? null, error: null };
          },
        };
        return api;
      },
      update(patch: Partial<GoogleConnectionRow>) {
        return {
          async eq(col: string, val: unknown) {
            for (const r of rows) {
              if ((r as unknown as Record<string, unknown>)[col] === val) Object.assign(r, patch);
            }
            return { data: null, error: null };
          },
        };
      },
      delete() {
        return {
          async eq(col: string, val: unknown) {
            for (let i = rows.length - 1; i >= 0; i--) {
              if ((rows[i] as unknown as Record<string, unknown>)[col] === val) rows.splice(i, 1);
            }
            return { data: null, error: null };
          },
        };
      },
    };
  }
  return { from } as unknown as SupabaseClient;
}

describe("getGoogleConnection", () => {
  it("returns only the named organization's row (never another org's)", async () => {
    const orgA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const orgB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const db = makeFakeDb([
      makeRow({ id: "row-a", organization_id: orgA }),
      makeRow({ id: "row-b", organization_id: orgB }),
    ]);

    const a = await getGoogleConnection(db, orgA);
    const b = await getGoogleConnection(db, orgB);

    expect(a?.id).toBe("row-a");
    expect(b?.id).toBe("row-b");
  });

  it("returns null when the organization has no connection", async () => {
    const db = makeFakeDb([makeRow({ organization_id: "other-org" })]);
    expect(await getGoogleConnection(db, "no-such-org")).toBeNull();
  });
});

describe("markBroken", () => {
  it("flips the row to broken and records the reason", async () => {
    const rows = [makeRow({ id: "row-1", status: "connected", broken_reason: null })];
    const db = makeFakeDb(rows);

    await markBroken(db, "row-1", "invalid_grant");

    expect(rows[0].status).toBe("broken");
    expect(rows[0].broken_reason).toBe("invalid_grant");
    expect(rows[0].broken_at).not.toBeNull();
  });
});

describe("deleteConnection", () => {
  it("removes the named org's row and leaves other orgs untouched", async () => {
    const rows = [
      makeRow({ id: "keep", organization_id: "org-keep" }),
      makeRow({ id: "drop", organization_id: "org-drop" }),
    ];
    const db = makeFakeDb(rows);

    await deleteConnection(db, "org-drop");

    expect(rows.map((r) => r.id)).toEqual(["keep"]);
  });
});
