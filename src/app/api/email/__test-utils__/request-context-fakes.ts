// Supabase fakes for the #85 converted-route tests (email + the misc
// endpoints batched with it). The routes now run through
// `withRequestContext`, so a route test exercises the User client the
// wrapper authenticates against — and, for `serviceClient: true` routes,
// a Service client the route body reads/writes with.
//
// The fakes cover only the query surface these routes touch: a chainable,
// thenable select/filter builder plus storage and rpc on the Service
// client. Filters are recorded but only `eq` actually narrows rows — the
// tests assert on the wrapper's allow/deny, not on query semantics.

type Row = Record<string, unknown>;

interface QueryResult {
  data: Row[] | Row | null;
  error: { message: string } | null;
  count?: number;
}

// A chainable builder: every filter/modifier returns `this`, and the
// builder is awaitable (thenable). `single`/`maybeSingle` resolve to one
// row; awaiting the builder directly resolves to the row list.
//
// `onWrite`, when supplied, records the payload handed to insert/update so
// a write-path test can assert WHAT the route persisted (e.g. that an owner
// id was computed server-side, never honored from the request body) rather
// than only that the call returned a row.
function queryBuilder(
  rows: Row[],
  onWrite?: (op: "insert" | "update", payload: Row | Row[]) => void,
): Record<string, unknown> {
  let filtered = [...rows];
  const builder: Record<string, unknown> = {};
  const passthrough = [
    "select", "order", "limit", "range", "or", "ilike", "not", "in",
    "gt", "gte", "lt", "lte", "neq", "overlaps", "update", "insert", "delete",
  ];
  for (const m of passthrough) {
    builder[m] = () => builder;
  }
  if (onWrite) {
    builder.insert = (payload: Row | Row[]) => {
      onWrite("insert", payload);
      return builder;
    };
    builder.update = (payload: Row | Row[]) => {
      onWrite("update", payload);
      return builder;
    };
  }
  builder.eq = (col: string, val: unknown) => {
    filtered = filtered.filter((r) => r[col] === val);
    return builder;
  };
  builder.single = async () => ({
    data: filtered[0] ?? null,
    error: filtered[0] ? null : { message: "no rows" },
  });
  builder.maybeSingle = async () => ({ data: filtered[0] ?? null, error: null });
  builder.then = (resolve: (v: QueryResult) => unknown) =>
    resolve({ data: filtered, error: null, count: filtered.length });
  return builder;
}

// A fake User client — what `withRequestContext` authenticates against.
// `tables` seeds whatever the wrapper or route reads; at minimum
// `user_organizations` (membership) and `user_organization_permissions`
// (grants), built conveniently via `memberTables`.
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
    storage: {
      from() {
        return {
          async download() {
            return { data: null, error: { message: "not found" } };
          },
          async upload() {
            return { data: null, error: null };
          },
          async remove() {
            return { data: [], error: null };
          },
        };
      },
    },
  };
}

// A fake Service client for `serviceClient: true` routes. Pass `onWrite` to
// capture the payloads the route inserts/updates, tagged with the table —
// useful for pinning that a write owns a row to the authenticated caller and
// not to an attacker-supplied id.
export function fakeServiceClient(opts: {
  tables?: Record<string, Row[]>;
  onWrite?: (table: string, op: "insert" | "update", payload: Row | Row[]) => void;
} = {}) {
  const tables = opts.tables ?? {};
  return {
    from(table: string) {
      return queryBuilder(
        tables[table] ?? [],
        opts.onWrite ? (op, payload) => opts.onWrite!(table, op, payload) : undefined,
      );
    },
    async rpc() {
      return { data: [], error: null };
    },
    storage: {
      from() {
        return {
          async download() {
            return { data: null, error: { message: "not found" } };
          },
          async upload() {
            return { data: null, error: null };
          },
          async remove() {
            return { data: [], error: null };
          },
        };
      },
    },
  };
}

// Build the `tables` map for a caller who is a member of the active
// organization with a given role and set of granted permission keys.
export function memberTables(opts: {
  userId: string;
  membershipId?: string;
  orgId?: string;
  role: string;
  grants?: string[];
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
  };
}
