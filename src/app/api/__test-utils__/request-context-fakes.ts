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

// A recorded mutation. Route tests assert the payload a handler wrote (e.g. that
// a `note` field reached `.insert()` / `.update()`), which the no-op builder
// would otherwise swallow. Recording is a side-effect only — return values are
// unchanged, so existing tests are unaffected.
export type Mutation = {
  table: string;
  op: "insert" | "update" | "upsert" | "delete";
  payload?: unknown;
};

// A PostgREST-style error, enough for routes that branch on `error.code`
// (e.g. "23505" unique_violation) or surface `error.message`. Inject one per
// table via `errorsByTable` to exercise a route's DB-error handling.
export type FakeError = { code?: string; message: string };

type Awaitable = {
  maybeSingle<T = Row>(): Promise<{ data: T | null; error: FakeError | null }>;
  single<T = Row>(): Promise<{ data: T | null; error: FakeError | null }>;
  then(resolve: (v: { data: Row[]; error: FakeError | null }) => unknown): unknown;
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
  // PostgREST `.returns<T>()` only retypes the awaited result; the builder
  // stays the same loose thenable, so we model the resolved shape on T.
  returns<T = Row[]>(): { then(resolve: (v: { data: T; error: FakeError | null }) => unknown): unknown };
}

function queryBuilder(
  rows: Row[],
  table?: string,
  mutations?: Mutation[],
  error?: FakeError,
): QueryBuilder {
  let filtered = [...rows];
  const passthrough = () => builder;
  const record = (op: Mutation["op"], payload?: unknown) => {
    if (mutations && table) mutations.push({ table, op, payload });
    return builder;
  };
  const builder: QueryBuilder = {
    select: passthrough,
    insert: (payload) => record("insert", payload),
    update: (payload) => record("update", payload),
    delete: () => record("delete"),
    upsert: (payload) => record("upsert", payload),
    eq(col, val) {
      filtered = filtered.filter((r) => r[col] === val);
      return builder;
    },
    in(col, vals) {
      filtered = filtered.filter((r) => vals.includes(r[col]));
      return builder;
    },
    not(...args) {
      // Model PostgREST `.not(col, "is", null)` (IS NOT NULL); a missing column
      // counts as null. Any other `.not(...)` form stays a passthrough.
      const [col, op, val] = args as [string, string, unknown];
      if (op === "is" && val === null) {
        filtered = filtered.filter((r) => r[col as string] != null);
      }
      return builder;
    },
    is(...args) {
      // Model PostgREST `.is(col, null)` (IS NULL); a missing column counts as
      // null. A non-null target stays a passthrough.
      const [col, val] = args as [string, unknown];
      if (val === null) {
        filtered = filtered.filter((r) => r[col as string] == null);
      }
      return builder;
    },
    lt: passthrough,
    gt: passthrough,
    or: passthrough,
    order: passthrough,
    limit: passthrough,
    // `.returns<T>()` is terminal in the query paths the fakes exercise: it only
    // retypes the awaited list. Hand back the same loose thenable, retyped on T.
    returns<T = Row[]>() {
      return builder as unknown as {
        then(resolve: (v: { data: T; error: FakeError | null }) => unknown): unknown;
      };
    },
    async maybeSingle<T = Row>() {
      if (error) return { data: null, error };
      return { data: (filtered[0] ?? null) as T | null, error: null };
    },
    async single<T = Row>() {
      if (error) return { data: null, error };
      return { data: (filtered[0] ?? null) as T | null, error: null };
    },
    then(resolve) {
      if (error) return resolve({ data: [], error });
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
  user: { id: string; email?: string } | null;
  tables?: Record<string, Row[]>;
  /** Inject a DB error for a table's reads/writes (keyed by table name). */
  errorsByTable?: Record<string, FakeError>;
}) {
  const tables = opts.tables ?? {};
  const mutations: Mutation[] = [];
  return {
    auth: {
      async getUser() {
        return { data: { user: opts.user }, error: null };
      },
    },
    from(table: string) {
      return queryBuilder(
        tables[table] ?? [],
        table,
        mutations,
        opts.errorsByTable?.[table],
      );
    },
    storage: fakeStorage(),
    // Recorded insert/update/upsert/delete payloads, in call order.
    __mutations: mutations,
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
  const mutations: Mutation[] = [];
  return {
    from(table: string) {
      return queryBuilder(tables[table] ?? [], table, mutations);
    },
    storage: fakeStorage(),
    __mutations: mutations,
  };
}
