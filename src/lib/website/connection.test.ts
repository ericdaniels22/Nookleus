// ENCRYPTION_KEY must exist before the encryption helper runs (upsertConnection
// encrypts the Application Password in the lib layer). 32 bytes of hex.
process.env.ENCRYPTION_KEY =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveConnectionState,
  toConnectionSummary,
  getWebsiteConnection,
  markBroken,
  deleteConnection,
  upsertConnection,
} from "./connection";
import { decrypt } from "../encryption";
import type { WebsiteConnectionRow } from "./types";

// #612 — the Website connection's public shape is derived purely from its row.
// A missing row is "disconnected" (disconnect deletes the row, so absence IS the
// state); a present row reports its stored status; and the summary never leaks
// the Application Password.

function makeRow(overrides: Partial<WebsiteConnectionRow> = {}): WebsiteConnectionRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    organization_id: "22222222-2222-4222-8222-222222222222",
    provider: "wordpress",
    site_url: "https://aaadisasterrecovery.com",
    username: "marketing",
    application_password_encrypted: "iv:tag:cipher",
    account_name: "AAA Disaster Recovery",
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
  it("summarises a missing row as disconnected with no site", () => {
    expect(toConnectionSummary(null)).toEqual({
      state: "disconnected",
      provider: null,
      site_url: null,
      username: null,
      account_name: null,
      broken_reason: null,
      connected_at: null,
    });
  });

  it("summarises a connected row without exposing the Application Password", () => {
    const summary = toConnectionSummary(
      makeRow({ created_at: "2026-06-01T09:00:00.000Z" }),
    );
    expect(summary).toEqual({
      state: "connected",
      provider: "wordpress",
      site_url: "https://aaadisasterrecovery.com",
      username: "marketing",
      account_name: "AAA Disaster Recovery",
      broken_reason: null,
      connected_at: "2026-06-01T09:00:00.000Z",
    });
    // The summary type has no password field; assert the shape carries none.
    expect(JSON.stringify(summary)).not.toContain("cipher");
    expect(JSON.stringify(summary)).not.toContain("application_password");
  });

  it("carries the broken reason through for the reconnect prompt", () => {
    const summary = toConnectionSummary(
      makeRow({ status: "broken", broken_reason: "invalid_credentials" }),
    );
    expect(summary.state).toBe("broken");
    expect(summary.broken_reason).toBe("invalid_credentials");
  });
});

// ---------------------------------------------------------------------------
// In-memory website_connection fake. Models just the chain the store uses:
//   select("*").eq("organization_id", x).maybeSingle()
//   update({...}).eq("id", x)
//   delete().eq("organization_id", x)
// `eq` is recorded so a test can prove the store scopes by the column it claims.
// ---------------------------------------------------------------------------
function makeFakeDb(rows: WebsiteConnectionRow[]) {
  function from(table: string) {
    if (table !== "website_connection") throw new Error(`unexpected table: ${table}`);
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
      update(patch: Partial<WebsiteConnectionRow>) {
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
      // upsert(values, { onConflict }) — replace the row whose conflict column
      // matches, else append. Models the one-row-per-org upsert the connect
      // route relies on (a reconnect overwrites the prior row in place).
      async upsert(values: WebsiteConnectionRow, opts?: { onConflict?: string }) {
        const key = opts?.onConflict ?? "id";
        const conflictVal = (values as unknown as Record<string, unknown>)[key];
        const existing = rows.find(
          (r) => (r as unknown as Record<string, unknown>)[key] === conflictVal,
        );
        if (existing) {
          Object.assign(existing, values);
        } else {
          rows.push({ ...values });
        }
        return { data: null, error: null };
      },
    };
  }
  return { from } as unknown as SupabaseClient;
}

describe("getWebsiteConnection", () => {
  it("returns only the named organization's row (never another org's)", async () => {
    const orgA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const orgB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const db = makeFakeDb([
      makeRow({ id: "row-a", organization_id: orgA }),
      makeRow({ id: "row-b", organization_id: orgB }),
    ]);

    const a = await getWebsiteConnection(db, orgA);
    const b = await getWebsiteConnection(db, orgB);

    expect(a?.id).toBe("row-a");
    expect(b?.id).toBe("row-b");
  });

  it("returns null when the organization has no connection", async () => {
    const db = makeFakeDb([makeRow({ organization_id: "other-org" })]);
    expect(await getWebsiteConnection(db, "no-such-org")).toBeNull();
  });
});

describe("markBroken", () => {
  it("flips the row to broken and records the reason", async () => {
    const rows = [makeRow({ id: "row-1", status: "connected", broken_reason: null })];
    const db = makeFakeDb(rows);

    await markBroken(db, "row-1", "invalid_credentials");

    expect(rows[0].status).toBe("broken");
    expect(rows[0].broken_reason).toBe("invalid_credentials");
    expect(rows[0].broken_at).not.toBeNull();
  });

  it("does not throw and logs loudly when the flip itself fails (never silent)", async () => {
    // The UPDATE is rejected by the DB. markBroken runs on a publish/re-check
    // path — it must not throw into that caller, and the failure must be LOUD:
    // a silent failure leaves the row 'connected' while publishing keeps 401-ing
    // and the UI never raises the reconnect prompt (#612: never silent failure).
    const db = {
      from() {
        return {
          update() {
            return {
              async eq() {
                return { data: null, error: { message: "update denied" } };
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        markBroken(db, "row-1", "invalid_credentials"),
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
      // The loud line names the connection so the failure is diagnosable.
      const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("row-1");
    } finally {
      errorSpy.mockRestore();
    }
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

describe("upsertConnection", () => {
  const params = {
    organizationId: "org-1",
    provider: "wordpress" as const,
    siteUrl: "https://aaadisasterrecovery.com",
    username: "marketing",
    applicationPassword: "abcd efgh ijkl mnop",
    accountName: "AAA Disaster Recovery",
    connectedBy: "user-9",
  };

  it("encrypts the Application Password — never stores it as plaintext", async () => {
    const rows: WebsiteConnectionRow[] = [];
    const db = makeFakeDb(rows);

    const { error } = await upsertConnection(db, params);

    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    const stored = rows[0].application_password_encrypted;
    // The stored value is ciphertext, not the password, and decrypts back to it.
    expect(stored).not.toBe("abcd efgh ijkl mnop");
    expect(stored).not.toContain("abcd efgh ijkl mnop");
    expect(decrypt(stored)).toBe("abcd efgh ijkl mnop");
  });

  it("stores a connected row carrying the account, site and connector", async () => {
    const rows: WebsiteConnectionRow[] = [];
    const db = makeFakeDb(rows);

    await upsertConnection(db, params);

    expect(rows[0]).toMatchObject({
      organization_id: "org-1",
      provider: "wordpress",
      site_url: "https://aaadisasterrecovery.com",
      username: "marketing",
      account_name: "AAA Disaster Recovery",
      status: "connected",
      broken_reason: null,
      broken_at: null,
      connected_by: "user-9",
    });
  });

  it("reconnect overwrites the org's row in place and clears the broken state", async () => {
    const rows = [
      makeRow({
        organization_id: "org-1",
        status: "broken",
        broken_reason: "invalid_credentials",
        broken_at: "2026-06-01T00:00:00.000Z",
        account_name: "Old Name",
      }),
    ];
    const db = makeFakeDb(rows);

    await upsertConnection(db, { ...params, accountName: "New Name" });

    // Still exactly one row for the org — reconnect replaced, not duplicated.
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("connected");
    expect(rows[0].broken_reason).toBeNull();
    expect(rows[0].broken_at).toBeNull();
    expect(rows[0].account_name).toBe("New Name");
  });
});
