// Supabase fakes for the converted `expenses` route tests. The routes now
// run through `withRequestContext`, so a route test exercises two clients:
//
//   * the User client — what the wrapper authenticates against and what
//     the POST route reads `user_profiles` from;
//   * the Service client — what the route bodies read/write expenses with.
//
// Both are table-row fakes covering only the query surface these routes
// actually use: select / eq / order / maybeSingle / awaited-list, plus rpc
// and storage on the Service client.

type Row = Record<string, unknown>;

export interface SelectBuilder {
  select(cols?: string): SelectBuilder;
  eq(col: string, val: unknown): SelectBuilder;
  order(col: string, opts?: unknown): SelectBuilder;
  maybeSingle<T = Row>(): Promise<{ data: T | null; error: null }>;
  then(resolve: (v: { data: Row[]; error: null }) => unknown): unknown;
}

function selectBuilder(rows: Row[]): SelectBuilder {
  let filtered = [...rows];
  const builder: SelectBuilder = {
    select() {
      return builder;
    },
    eq(col, val) {
      filtered = filtered.filter((r) => r[col] === val);
      return builder;
    },
    order() {
      return builder;
    },
    async maybeSingle<T = Row>() {
      return { data: (filtered[0] ?? null) as T | null, error: null };
    },
    then(resolve) {
      return resolve({ data: filtered, error: null });
    },
  };
  return builder;
}

// A fake User client. `tables` seeds whatever the wrapper or route reads:
// `user_organizations` (membership), `user_organization_permissions`
// (grants), and `user_profiles` for the POST route.
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
      return selectBuilder(tables[table] ?? []);
    },
  };
}

// Convenience: build the `tables` map for a caller who is a member of the
// active organization with a given role and set of granted permissions.
export function memberTables(opts: {
  userId: string;
  membershipId?: string;
  orgId?: string;
  role: string;
  grants?: string[];
  profile?: { full_name: string } | null;
}): Record<string, Row[]> {
  const membershipId = opts.membershipId ?? "m-1";
  const orgId = opts.orgId ?? "org-1";
  const tables: Record<string, Row[]> = {
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
  if (opts.profile !== undefined) {
    tables.user_profiles =
      opts.profile === null ? [] : [{ id: opts.userId, ...opts.profile }];
  }
  return tables;
}

interface RpcResult {
  data?: unknown;
  error?: { message: string } | null;
}

export interface ServiceFake {
  client: unknown;
  rpcCalls: { name: string; args: unknown }[];
  storageRemovals: { bucket: string; paths: string[] }[];
}

// A fake Service client: table reads, rpc (recorded), and storage
// remove / createSignedUrl.
export function fakeServiceClient(opts: {
  tables?: Record<string, Row[]>;
  rpcResults?: Record<string, RpcResult>;
}): ServiceFake {
  const tables = opts.tables ?? {};
  const rpcCalls: { name: string; args: unknown }[] = [];
  const storageRemovals: { bucket: string; paths: string[] }[] = [];
  const client = {
    from(table: string) {
      return selectBuilder(tables[table] ?? []);
    },
    async rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args });
      const result = opts.rpcResults?.[name];
      return { data: result?.data ?? null, error: result?.error ?? null };
    },
    storage: {
      from(bucket: string) {
        return {
          async remove(paths: string[]) {
            storageRemovals.push({ bucket, paths });
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
    },
  };
  return { client, rpcCalls, storageRemovals };
}
