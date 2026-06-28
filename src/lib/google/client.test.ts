// ENCRYPTION_KEY must exist before the encryption helper runs. 32 bytes of hex.
process.env.ENCRYPTION_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encrypt, decrypt } from "@/lib/encryption";
import {
  shouldRefreshAccessToken,
  getValidGoogleAccessToken,
  getGoogleClient,
} from "./client";
import type { GoogleConnectionRow } from "./types";
import type { GoogleOAuthConfig } from "./config";

const config: GoogleOAuthConfig = {
  clientId: "client-id-123",
  clientSecret: "client-secret-abc",
  redirectUri: "https://app.nookleus.com/api/google/callback",
};

const NOW = Date.parse("2026-06-27T12:00:00.000Z");
const HOUR = 3600 * 1000;

function makeRow(overrides: Partial<GoogleConnectionRow> = {}): GoogleConnectionRow {
  return {
    id: "row-1",
    organization_id: "org-1",
    google_account_email: "owner@aaadisasterrecovery.com",
    google_account_name: "AAA Owner",
    refresh_token_encrypted: encrypt("rt-1"),
    access_token_encrypted: encrypt("cached-at"),
    access_token_expires_at: new Date(NOW + HOUR).toISOString(),
    scopes: ["openid"],
    status: "connected",
    broken_reason: null,
    broken_at: null,
    connected_by: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDb(rows: GoogleConnectionRow[]) {
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
              filters.every(([c, v]) => (r as unknown as Record<string, unknown>)[c] === v),
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
    };
  }
  return { from } as unknown as SupabaseClient;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// A fetch that fails the test if it is ever called — proves "no refresh happened".
const failFetch = (() => {
  throw new Error("fetch should not have been called");
}) as unknown as typeof fetch;

describe("shouldRefreshAccessToken", () => {
  it("refreshes when there is no cached expiry", () => {
    expect(shouldRefreshAccessToken(null, NOW)).toBe(true);
  });
  it("does not refresh a token comfortably in the future", () => {
    expect(shouldRefreshAccessToken(new Date(NOW + HOUR).toISOString(), NOW)).toBe(false);
  });
  it("refreshes a token inside the 5-minute threshold", () => {
    expect(shouldRefreshAccessToken(new Date(NOW + 60 * 1000).toISOString(), NOW)).toBe(true);
  });
  it("refreshes an already-expired token", () => {
    expect(shouldRefreshAccessToken(new Date(NOW - HOUR).toISOString(), NOW)).toBe(true);
  });
  it("refreshes when the expiry is unparseable", () => {
    expect(shouldRefreshAccessToken("not-a-date", NOW)).toBe(true);
  });
});

describe("getValidGoogleAccessToken", () => {
  it("returns null when the org has no connection", async () => {
    const token = await getValidGoogleAccessToken(makeDb([]), "org-1", {
      config,
      fetchImpl: failFetch,
      now: () => NOW,
    });
    expect(token).toBeNull();
  });

  it("returns null for a broken connection without attempting a refresh", async () => {
    const db = makeDb([makeRow({ status: "broken" })]);
    const token = await getValidGoogleAccessToken(db, "org-1", {
      config,
      fetchImpl: failFetch,
      now: () => NOW,
    });
    expect(token).toBeNull();
  });

  it("returns the cached token when it is still valid (no refresh)", async () => {
    const db = makeDb([makeRow()]);
    const token = await getValidGoogleAccessToken(db, "org-1", {
      config,
      fetchImpl: failFetch,
      now: () => NOW,
    });
    expect(token?.accessToken).toBe("cached-at");
  });

  it("refreshes an expired token, persists it encrypted, and returns it", async () => {
    const rows = [makeRow({ access_token_expires_at: new Date(NOW - HOUR).toISOString() })];
    const db = makeDb(rows);
    const fetchImpl = (async () =>
      jsonResponse({ access_token: "fresh-at", expires_in: 3600, scope: "openid" })) as unknown as typeof fetch;

    const token = await getValidGoogleAccessToken(db, "org-1", { config, fetchImpl, now: () => NOW });

    expect(token?.accessToken).toBe("fresh-at");
    // Persisted, and encrypted at rest (not stored in the clear).
    expect(rows[0].access_token_encrypted).not.toBe("fresh-at");
    expect(decrypt(rows[0].access_token_encrypted!)).toBe("fresh-at");
    expect(rows[0].access_token_expires_at).toBe(new Date(NOW + HOUR).toISOString());
  });

  it("marks the connection broken and returns null on invalid_grant", async () => {
    const rows = [makeRow({ access_token_expires_at: new Date(NOW - HOUR).toISOString() })];
    const db = makeDb(rows);
    const fetchImpl = (async () =>
      jsonResponse({ error: "invalid_grant" }, 400)) as unknown as typeof fetch;

    const token = await getValidGoogleAccessToken(db, "org-1", { config, fetchImpl, now: () => NOW });

    expect(token).toBeNull();
    expect(rows[0].status).toBe("broken");
    expect(rows[0].broken_reason).toBe("invalid_grant");
  });

  it("rethrows a transient refresh failure WITHOUT breaking the connection", async () => {
    const rows = [makeRow({ access_token_expires_at: new Date(NOW - HOUR).toISOString() })];
    const db = makeDb(rows);
    const fetchImpl = (async () => new Response("upstream", { status: 503 })) as unknown as typeof fetch;

    await expect(
      getValidGoogleAccessToken(db, "org-1", { config, fetchImpl, now: () => NOW }),
    ).rejects.toBeTruthy();
    expect(rows[0].status).toBe("connected");
  });
});

describe("getGoogleClient", () => {
  it("returns null when there is no usable connection", async () => {
    const client = await getGoogleClient(makeDb([]), "org-1", {
      config,
      fetchImpl: failFetch,
      now: () => NOW,
    });
    expect(client).toBeNull();
  });

  it("returns an authorized client that injects the bearer token", async () => {
    const db = makeDb([makeRow()]);
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;

    const client = await getGoogleClient(db, "org-1", { config, fetchImpl, now: () => NOW });
    expect(client?.accountEmail).toBe("owner@aaadisasterrecovery.com");

    await client!.fetch("https://mybusiness.googleapis.com/v4/accounts");
    const headers = new Headers(calls.at(-1)!.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer cached-at");
  });
});
