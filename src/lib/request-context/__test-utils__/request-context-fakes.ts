// Supabase fakes for testing API routes converted to `withRequestContext`.
//
// A converted route test exercises up to two clients:
//
//   * the User client — what the wrapper authenticates against (reads
//     `user_organizations` for the membership role and
//     `user_organization_permissions` for the grants), and what
//     `accounting` route handlers query against via `ctx.supabase`;
//   * the Service client — what `qb` route handlers read/write with via
//     `ctx.serviceClient`.
//
// Both are backed by the same table-row fake, which covers the query
// surface these routes use: select / eq / is / in / gte / lte / lt /
// order / limit / range / maybeSingle, plus update / delete / insert.
// Filtering is applied for eq / is / in only — range filters (gte / lte /
// lt) and ordering are accepted but ignored, which is enough for the
// gating-and-happy-path coverage these tests need.

type Row = Record<string, unknown>;

export interface QueryBuilder {
  select(cols?: string, opts?: { count?: "exact"; head?: boolean }): QueryBuilder;
  eq(col: string, val: unknown): QueryBuilder;
  is(col: string, val: unknown): QueryBuilder;
  in(col: string, vals: unknown[]): QueryBuilder;
  gte(col: string, val: unknown): QueryBuilder;
  lte(col: string, val: unknown): QueryBuilder;
  lt(col: string, val: unknown): QueryBuilder;
  order(col?: string, opts?: unknown): QueryBuilder;
  limit(n: number): QueryBuilder;
  range(from: number, to: number): QueryBuilder;
  update(values?: Row): QueryBuilder;
  delete(opts?: { count?: "exact" }): QueryBuilder;
  insert(rows?: Row | Row[]): QueryBuilder;
  maybeSingle<T = Row>(): Promise<{ data: T | null; error: null }>;
  single<T = Row>(): Promise<{ data: T | null; error: null }>;
  then(
    resolve: (v: { data: Row[]; error: null; count: number }) => unknown,
  ): unknown;
}

function makeBuilder(rows: Row[]): QueryBuilder {
  let filtered = [...rows];
  const builder: QueryBuilder = {
    select() {
      return builder;
    },
    eq(col, val) {
      filtered = filtered.filter((r) => r[col] === val);
      return builder;
    },
    is(col, val) {
      filtered = filtered.filter((r) => (r[col] ?? null) === val);
      return builder;
    },
    in(col, vals) {
      filtered = filtered.filter((r) => vals.includes(r[col]));
      return builder;
    },
    gte() {
      return builder;
    },
    lte() {
      return builder;
    },
    lt() {
      return builder;
    },
    order() {
      return builder;
    },
    limit(n) {
      filtered = filtered.slice(0, n);
      return builder;
    },
    range(from, to) {
      filtered = filtered.slice(from, to + 1);
      return builder;
    },
    update() {
      return builder;
    },
    delete() {
      return builder;
    },
    insert() {
      return builder;
    },
    async maybeSingle<T = Row>() {
      return { data: (filtered[0] ?? null) as T | null, error: null };
    },
    async single<T = Row>() {
      return { data: (filtered[0] ?? null) as T | null, error: null };
    },
    then(resolve) {
      return resolve({ data: filtered, error: null, count: filtered.length });
    },
  };
  return builder;
}

// A fake Supabase client. `user` is what `auth.getUser()` resolves; pass
// `null` to simulate an unauthenticated request. `tables` seeds whatever
// the wrapper or the route handler reads — an unseeded table reads empty.
export function fakeClient(opts: {
  user?: { id: string } | null;
  tables?: Record<string, Row[]>;
}) {
  const tables = opts.tables ?? {};
  return {
    auth: {
      async getUser() {
        return { data: { user: opts.user ?? null }, error: null };
      },
    },
    from(table: string) {
      return makeBuilder(tables[table] ?? []);
    },
  };
}

// Build the `tables` map for a caller who is a member of the active
// organization (`org-1`, the value `getActiveOrganizationId` is mocked to
// return) with a given role and set of granted permission keys.
export function memberTables(opts: {
  userId: string;
  membershipId?: string;
  role: string;
  grants?: string[];
}): Record<string, Row[]> {
  const membershipId = opts.membershipId ?? "m-1";
  return {
    user_organizations: [
      {
        id: membershipId,
        role: opts.role,
        user_id: opts.userId,
        organization_id: "org-1",
      },
    ],
    user_organization_permissions: (opts.grants ?? []).map((permission_key) => ({
      user_organization_id: membershipId,
      permission_key,
      granted: true,
    })),
  };
}
