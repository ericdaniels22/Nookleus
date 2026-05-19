// Supabase fakes for the converted `jobs` / `payments` / `payment-requests`
// route tests (#83). These routes now run through `withRequestContext`, so a
// route test exercises two clients:
//
//   * the User client — what the wrapper authenticates against (and what the
//     logged-in-only routes query directly);
//   * the Service client — what permission-gated route bodies read/write with.
//
// Both are table-row fakes covering the query surface these routes use:
// select / eq / in / not / is / lt / or / order / limit / maybeSingle /
// single / awaited-list, plus update / insert / delete (recorded, no-op on
// the seeded rows) and storage.

type Row = Record<string, unknown>;

type Awaitable = {
  maybeSingle<T = Row>(): Promise<{ data: T | null; error: null }>;
  single<T = Row>(): Promise<{ data: T | null; error: null }>;
  then(resolve: (v: { data: Row[]; error: null }) => unknown): unknown;
};

// One builder type for both reads and mutations: every filter and mutation
// method returns the builder; `eq` / `in` actually filter so list and
// maybeSingle reads stay meaningful; the rest are no-ops.
export interface QueryBuilder extends Awaitable {
  select(cols?: string): QueryBuilder;
  insert(payload?: unknown): QueryBuilder;
  update(payload?: unknown): QueryBuilder;
  delete(): QueryBuilder;
  upsert(payload?: unknown, opts?: unknown): QueryBuilder;
  eq(col: string, val: unknown): QueryBuilder;
  in(col: string, vals: unknown[]): QueryBuilder;
  not(...args: unknown[]): QueryBuilder;
  is(...args: unknown[]): QueryBuilder;
  lt(...args: unknown[]): QueryBuilder;
  gt(...args: unknown[]): QueryBuilder;
  or(...args: unknown[]): QueryBuilder;
  order(...args: unknown[]): QueryBuilder;
  limit(...args: unknown[]): QueryBuilder;
}

function queryBuilder(rows: Row[]): QueryBuilder {
  let filtered = [...rows];
  const passthrough = () => builder;
  const builder: QueryBuilder = {
    select: passthrough,
    insert: passthrough,
    update: passthrough,
    delete: passthrough,
    upsert: passthrough,
    eq(col, val) {
      filtered = filtered.filter((r) => r[col] === val);
      return builder;
    },
    in(col, vals) {
      filtered = filtered.filter((r) => vals.includes(r[col]));
      return builder;
    },
    not: passthrough,
    is: passthrough,
    lt: passthrough,
    gt: passthrough,
    or: passthrough,
    order: passthrough,
    limit: passthrough,
    async maybeSingle<T = Row>() {
      return { data: (filtered[0] ?? null) as T | null, error: null };
    },
    async single<T = Row>() {
      return { data: (filtered[0] ?? null) as T | null, error: null };
    },
    then(resolve) {
      return resolve({ data: filtered, error: null });
    },
  };
  return builder;
}

// Storage stub shared by both client fakes: `remove` echoes the paths back
// and `createSignedUrl` returns a deterministic test URL.
function fakeStorage() {
  return {
    from() {
      return {
        async remove(paths: string[]) {
          return { data: paths.map((name) => ({ name })), error: null };
        },
        async createSignedUrl(path: string) {
          return {
            data: { signedUrl: `https://signed.test/${path}` },
            error: null,
          };
        },
      };
    },
  };
}

// A fake User client. `tables` seeds whatever the wrapper or route reads:
// `user_organizations` (membership), `user_organization_permissions`
// (grants), and any table a route queries directly. `storage` is stubbed so
// permission-gated routes that read/write storage on the User client (the
// job files/photos routes) can be exercised end-to-end.
export function fakeUserClient(opts: {
  user: { id: string } | null;
  tables?: Record<string, Row[]>;
}) {
  const tables = opts.tables ?? {};
  return {
    auth: {
      async getUser() {
        return { data: { user: opts.user }, error: null };
      },
    },
    from(table: string) {
      return queryBuilder(tables[table] ?? []);
    },
    storage: fakeStorage(),
  };
}

// Convenience: build the `tables` map for a caller who is a member of the
// active organization with a given role and set of granted permissions.
// Pass extra route-queried tables via `extraTables`.
export function memberTables(opts: {
  userId: string;
  membershipId?: string;
  orgId?: string;
  role: string;
  grants?: string[];
  extraTables?: Record<string, Row[]>;
}): Record<string, Row[]> {
  const membershipId = opts.membershipId ?? "m-1";
  const orgId = opts.orgId ?? "org-1";
  return {
    user_organizations: [
      {
        id: membershipId,
        role: opts.role,
        user_id: opts.userId,
        organization_id: orgId,
      },
    ],
    user_organization_permissions: (opts.grants ?? []).map((permission_key) => ({
      user_organization_id: membershipId,
      permission_key,
      granted: true,
    })),
    ...(opts.extraTables ?? {}),
  };
}

// A fake Service client: table reads/writes plus storage remove /
// createSignedUrl.
export function fakeServiceClient(opts: {
  tables?: Record<string, Row[]>;
} = {}) {
  const tables = opts.tables ?? {};
  return {
    from(table: string) {
      return queryBuilder(tables[table] ?? []);
    },
    storage: fakeStorage(),
  };
}
