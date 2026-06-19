import { describe, it, expect, beforeEach } from "vitest";

import {
  registerDeviceToken,
  listDeviceTokensForUsers,
  pruneDeviceTokens,
} from "./device-tokens";

// ---------------------------------------------------------------------------
// In-memory device_tokens fake.
//
// Models the one piece of DB behavior the registry leans on: a UNIQUE
// constraint on `token`, so an upsert with `onConflict: "token"` refreshes the
// existing row instead of inserting a duplicate. The registry takes an injected
// client (the route hands it a Service client; the dispatcher will reuse it),
// so a focused fake is all we need to drive its public functions.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
interface FakeError {
  message: string;
}

function makeFake() {
  const rows: Row[] = [];
  const errors: Record<string, FakeError | null> = {};

  function from(table: string) {
    if (table !== "device_tokens") {
      throw new Error(`unexpected table: ${table}`);
    }
    return {
      upsert(payload: Row, opts: { onConflict: string }) {
        const conflictCol = opts.onConflict;
        const incoming = Array.isArray(payload) ? payload : [payload];
        return {
          then(resolve: (v: { data: unknown; error: FakeError | null }) => unknown) {
            const err = errors["upsert"];
            if (err) return resolve({ data: null, error: err });
            for (const r of incoming) {
              const existing = rows.find((row) => row[conflictCol] === r[conflictCol]);
              if (existing) Object.assign(existing, r);
              else rows.push({ ...r });
            }
            return resolve({ data: null, error: null });
          },
        };
      },
      select() {
        let predicate: (r: Row) => boolean = () => true;
        const builder = {
          in(col: string, vals: unknown[]) {
            predicate = (r) => vals.includes(r[col]);
            return builder;
          },
          then(resolve: (v: { data: unknown; error: FakeError | null }) => unknown) {
            const err = errors["select"];
            if (err) return resolve({ data: null, error: err });
            return resolve({ data: rows.filter(predicate), error: null });
          },
        };
        return builder;
      },
      delete() {
        const builder = {
          in(col: string, vals: unknown[]) {
            return {
              then(resolve: (v: { data: unknown; error: FakeError | null }) => unknown) {
                const err = errors["delete"];
                if (err) return resolve({ data: null, error: err });
                for (let i = rows.length - 1; i >= 0; i--) {
                  if (vals.includes(rows[i][col])) rows.splice(i, 1);
                }
                return resolve({ data: null, error: null });
              },
            };
          },
        };
        return builder;
      },
    };
  }

  return {
    client: { from } as never,
    rows,
    setError(key: string, err: FakeError | null) {
      errors[key] = err;
    },
  };
}

type Fake = ReturnType<typeof makeFake>;

let fake: Fake;
beforeEach(() => {
  fake = makeFake();
});

describe("device-token registry", () => {
  it("registers a token, then lists it back for that user", async () => {
    await registerDeviceToken(fake.client, {
      userId: "user-1",
      organizationId: "org-1",
      token: "tok-aaa",
    });

    const tokens = await listDeviceTokensForUsers(fake.client, ["user-1"]);

    expect(tokens).toEqual(["tok-aaa"]);
  });

  it("is idempotent on the token — re-registering refreshes the same row, never duplicates", async () => {
    await registerDeviceToken(fake.client, {
      userId: "user-1",
      organizationId: "org-1",
      token: "tok-aaa",
    });
    // Same device, same token, but the member has since switched orgs.
    await registerDeviceToken(fake.client, {
      userId: "user-1",
      organizationId: "org-2",
      token: "tok-aaa",
    });

    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0]).toMatchObject({ token: "tok-aaa", organization_id: "org-2" });
  });

  it("keeps one row per device — a member with two devices lists both tokens", async () => {
    await registerDeviceToken(fake.client, {
      userId: "user-1",
      organizationId: "org-1",
      token: "iphone-tok",
    });
    await registerDeviceToken(fake.client, {
      userId: "user-1",
      organizationId: "org-1",
      token: "ipad-tok",
    });

    const tokens = await listDeviceTokensForUsers(fake.client, ["user-1"]);

    expect(tokens.sort()).toEqual(["ipad-tok", "iphone-tok"]);
  });

  it("lists only the requested members' tokens — never another member's", async () => {
    await registerDeviceToken(fake.client, {
      userId: "user-1",
      organizationId: "org-1",
      token: "mine",
    });
    await registerDeviceToken(fake.client, {
      userId: "user-2",
      organizationId: "org-1",
      token: "theirs",
    });

    const tokens = await listDeviceTokensForUsers(fake.client, ["user-1"]);

    expect(tokens).toEqual(["mine"]);
  });

  it("returns nothing for an empty user list without touching the DB", async () => {
    await registerDeviceToken(fake.client, {
      userId: "user-1",
      organizationId: "org-1",
      token: "mine",
    });

    expect(await listDeviceTokensForUsers(fake.client, [])).toEqual([]);
  });

  it("prunes only the dead tokens, leaving live ones registered", async () => {
    for (const token of ["dead-1", "alive", "dead-2"]) {
      await registerDeviceToken(fake.client, {
        userId: "user-1",
        organizationId: "org-1",
        token,
      });
    }

    await pruneDeviceTokens(fake.client, ["dead-1", "dead-2"]);

    expect(await listDeviceTokensForUsers(fake.client, ["user-1"])).toEqual(["alive"]);
  });

  it("prunes nothing for an empty token list without touching the DB", async () => {
    await registerDeviceToken(fake.client, {
      userId: "user-1",
      organizationId: "org-1",
      token: "alive",
    });

    await pruneDeviceTokens(fake.client, []);

    expect(await listDeviceTokensForUsers(fake.client, ["user-1"])).toEqual(["alive"]);
  });

  it("surfaces a DB error on register so the caller can react", async () => {
    fake.setError("upsert", { message: "constraint blew up" });

    await expect(
      registerDeviceToken(fake.client, {
        userId: "user-1",
        organizationId: "org-1",
        token: "tok",
      }),
    ).rejects.toThrow(/device_tokens upsert: constraint blew up/);
  });
});
