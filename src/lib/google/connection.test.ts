import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveConnectionState,
  toConnectionSummary,
  refreshTokenExpiresAt,
  marketingGoogleIndicator,
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
    last_consented_at: "2026-06-27T11:00:00.000Z",
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
      token_expires_at: null,
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
      // Production mode by default — no 7-day countdown.
      token_expires_at: null,
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

  it("computes the 7-day token expiry from last_consented_at in Testing mode", () => {
    const summary = toConnectionSummary(
      makeRow({ last_consented_at: "2026-06-20T00:00:00.000Z" }),
      { testingMode: true },
    );
    expect(summary.token_expires_at).toBe("2026-06-27T00:00:00.000Z");
  });

  it("leaves token_expires_at null in Production mode (the default)", () => {
    expect(toConnectionSummary(makeRow()).token_expires_at).toBeNull();
  });

  it("has no token expiry for a disconnected (null) row even in Testing mode", () => {
    expect(toConnectionSummary(null, { testingMode: true }).token_expires_at).toBeNull();
  });
});

// #789 — the per-org connection's Testing-mode refresh token lives 7 days from
// consent. This is the issue-time → expiry math the Marketing-page countdown
// rides on. Pure, env-agnostic: the caller decides whether it's Testing mode.
describe("refreshTokenExpiresAt", () => {
  const consent = "2026-06-01T00:00:00.000Z";

  it("returns null when not in Testing mode (Production has no 7-day expiry)", () => {
    expect(refreshTokenExpiresAt(consent, { testingMode: false })).toBeNull();
  });

  it("returns consent + 7 days in Testing mode", () => {
    expect(refreshTokenExpiresAt(consent, { testingMode: true })).toBe(
      "2026-06-08T00:00:00.000Z",
    );
  });

  it("returns null when there is no consent timestamp", () => {
    expect(refreshTokenExpiresAt(null, { testingMode: true })).toBeNull();
  });

  it("honours a custom ttl", () => {
    expect(refreshTokenExpiresAt(consent, { testingMode: true, ttlDays: 1 })).toBe(
      "2026-06-02T00:00:00.000Z",
    );
  });
});

// #789 — what the Marketing page actually renders: nothing while healthy or in
// Production, an amber heads-up within two days, red when expired or broken.
describe("marketingGoogleIndicator", () => {
  const now = Date.parse("2026-06-27T00:00:00.000Z");
  const DAY = 24 * 60 * 60 * 1000;

  it("shows nothing when there is no summary", () => {
    expect(marketingGoogleIndicator(null, now)).toEqual({ kind: "none" });
  });

  it("shows nothing when disconnected", () => {
    expect(
      marketingGoogleIndicator({ state: "disconnected", token_expires_at: null }, now),
    ).toEqual({ kind: "none" });
  });

  it("flags a broken connection as broken regardless of expiry", () => {
    expect(
      marketingGoogleIndicator({ state: "broken", token_expires_at: null }, now),
    ).toEqual({ kind: "broken" });
  });

  it("shows nothing when connected with no expiry (Production)", () => {
    expect(
      marketingGoogleIndicator({ state: "connected", token_expires_at: null }, now),
    ).toEqual({ kind: "none" });
  });

  it("is ok with several days left", () => {
    const exp = new Date(now + 5 * DAY).toISOString();
    expect(
      marketingGoogleIndicator({ state: "connected", token_expires_at: exp }, now),
    ).toEqual({ kind: "ok", daysRemaining: 5 });
  });

  it("warns (expiring) within two days", () => {
    const exp = new Date(now + 2 * DAY).toISOString();
    expect(
      marketingGoogleIndicator({ state: "connected", token_expires_at: exp }, now),
    ).toEqual({ kind: "expiring", daysRemaining: 2 });
  });

  it("rounds partial days up", () => {
    const exp = new Date(now + 1.5 * DAY).toISOString();
    expect(
      marketingGoogleIndicator({ state: "connected", token_expires_at: exp }, now),
    ).toEqual({ kind: "expiring", daysRemaining: 2 });
  });

  it("is expired once the expiry has passed", () => {
    const exp = new Date(now - DAY).toISOString();
    expect(
      marketingGoogleIndicator({ state: "connected", token_expires_at: exp }, now),
    ).toEqual({ kind: "expired" });
  });

  it("is expired exactly at the boundary", () => {
    const exp = new Date(now).toISOString();
    expect(
      marketingGoogleIndicator({ state: "connected", token_expires_at: exp }, now),
    ).toEqual({ kind: "expired" });
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
