// Supabase fakes for the converted `settings` route tests. The routes now
// run through `withRequestContext`, so a route test exercises the User
// client the wrapper authenticates against — `createServerSupabaseClient`.
//
// The wrapper reads, in order: `auth.getUser()`, the caller's
// `user_organizations` membership (id + role), then the granted
// `user_organization_permissions` keys. `fakeUserClient` + `memberTables`
// cover exactly that surface; route bodies that use the Service client are
// faked separately (e.g. with `makeSupabaseFake`).

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

// A fake User client. `tables` seeds whatever the wrapper reads:
// `user_organizations` (membership) and `user_organization_permissions`
// (grants).
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
