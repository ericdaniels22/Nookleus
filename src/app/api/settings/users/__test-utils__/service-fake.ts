// Service-client fake for the `settings/users` route tests. These routes
// run through `withRequestContext` with `serviceClient: true`, so a route
// test exercises two clients: the User client the wrapper authenticates
// against (`fakeUserClient` from the shared `settings` fakes) and this
// Service client the route bodies read/write with.
//
// The fake covers only the surface the three route bodies touch: a
// chainable select/insert/upsert/update builder plus `auth.admin` for the
// invite / ban calls. Filters are recorded but only `eq` narrows rows —
// the tests assert on the wrapper's allow/deny, not on query semantics.
// The `auth.admin` methods are vi.fn spies so a test can assert what (or
// whether) the route passed anything to them.

import { vi } from "vitest";

type Row = Record<string, unknown>;

function builder(rows: Row[]): Record<string, unknown> {
  let filtered = [...rows];
  let inserted: Row[] = [];
  const b: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "update", "delete", "upsert"]) {
    b[m] = () => b;
  }
  b.insert = (r: Row | Row[]) => {
    inserted = Array.isArray(r) ? r : [r];
    return b;
  };
  b.eq = (col: string, val: unknown) => {
    filtered = filtered.filter((r) => r[col] === val);
    return b;
  };
  b.maybeSingle = async () => ({ data: filtered[0] ?? null, error: null });
  b.single = async () => {
    const row = inserted[0] ?? filtered[0] ?? null;
    return { data: row, error: row ? null : { message: "no rows" } };
  };
  b.then = (resolve: (v: { data: Row[]; error: null }) => unknown) =>
    resolve({ data: filtered, error: null });
  return b;
}

// A fake Service client for the `settings/users` route bodies. `tables`
// seeds rows the bodies read (e.g. the target member's `user_organizations`
// row for the `permissions` PUT, or the membership row the PATCH guard
// reads). `auth.admin` stubs the invite/ban calls.
export function fakeUsersServiceClient(
  opts: { tables?: Record<string, Row[]> } = {},
) {
  const tables = opts.tables ?? {};
  return {
    from(table: string) {
      return builder(tables[table] ?? []);
    },
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })),
        inviteUserByEmail: vi.fn(async () => ({
          data: { user: { id: "invited-user" } },
          error: null,
        })),
        updateUserById: vi.fn(async () => ({
          data: { user: null },
          error: null,
        })),
      },
    },
  };
}
