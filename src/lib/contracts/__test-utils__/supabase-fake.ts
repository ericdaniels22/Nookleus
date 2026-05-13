// Shared Supabase fake for RPC-style contract route tests (void / restore
// / delete). Mirrors the supabase-js surface the routes actually exercise:
// auth.getUser via the server-helper client, and from/select/eq/in/
// maybeSingle/then + storage download/upload + rpc on the service client.
//
// Scope: routes that load a contract row, run a payment-block / status
// guard, optionally touch storage, then call a single RPC. finalize.ts is
// intentionally not migrated to this helper — it does direct UPDATE +
// INSERT on contracts/contract_events and needs .update()/.insert() chain
// builders that would over-fit this fake for the RPC-route callers.
//
// selectFromCalls is recorded for every from(table).select(...) so tests
// can positively assert that a code path did NOT consult a given table
// (e.g. the draft-delete route never reads invoices/payments).

type Row = Record<string, unknown>;
type PendingError = { message: string } | null;

interface FakeState {
  rows: Record<string, Row[]>;
  errors: Record<string, PendingError>;
  storageBlobs: Record<string, Uint8Array>;
  storageUploads: {
    bucket: string;
    path: string;
    bytes: Uint8Array;
    options?: unknown;
  }[];
  storageDownloads: { bucket: string; path: string }[];
  storageRemovals: { bucket: string; paths: string[] }[];
  rpcCalls: { name: string; args: unknown }[];
  selectFromCalls: string[];
}

export interface SupabaseFake {
  client: unknown;
  state: FakeState;
  seed(table: string, rows: Row[]): void;
  seedBlob(key: string, bytes: Uint8Array): void;
  setError(key: string, err: PendingError): void;
}

export function makeSupabaseFake(): SupabaseFake {
  const state: FakeState = {
    rows: {},
    errors: {},
    storageBlobs: {},
    storageUploads: [],
    storageDownloads: [],
    storageRemovals: [],
    rpcCalls: [],
    selectFromCalls: [],
  };

  function matchesFilters(row: Row, filters: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(filters)) {
      if (Array.isArray(v)) {
        if (!v.includes(row[k] as never)) return false;
      } else if (row[k] !== v) return false;
    }
    return true;
  }

  function selectBuilder(
    table: string,
    opts?: { count?: string; head?: boolean },
  ) {
    const filters: Record<string, unknown> = {};
    const builder = {
      eq(col: string, val: unknown) {
        filters[col] = val;
        return builder;
      },
      in(col: string, vals: unknown[]) {
        filters[col] = vals;
        return builder;
      },
      async maybeSingle() {
        const err = state.errors[`${table}.select`];
        if (err) return { data: null, error: err };
        const row = (state.rows[table] ?? []).find((r) =>
          matchesFilters(r, filters),
        );
        return { data: row ?? null, error: null };
      },
      then(
        resolve: (v: {
          data: unknown;
          error: PendingError;
          count?: number;
        }) => unknown,
      ): unknown {
        const err = state.errors[`${table}.select`];
        if (err) return resolve({ data: null, error: err });
        const rows = (state.rows[table] ?? []).filter((r) =>
          matchesFilters(r, filters),
        );
        if (opts?.count === "exact") {
          return resolve({ data: rows, error: null, count: rows.length });
        }
        return resolve({ data: rows, error: null });
      },
    };
    return builder;
  }

  const client = {
    from(table: string) {
      return {
        select(_cols?: string, opts?: { count?: string; head?: boolean }) {
          void _cols;
          state.selectFromCalls.push(table);
          return selectBuilder(table, opts);
        },
      };
    },
    storage: {
      from(bucket: string) {
        return {
          async download(path: string) {
            state.storageDownloads.push({ bucket, path });
            const err = state.errors[`storage.${bucket}.download`];
            if (err) return { data: null, error: err };
            const bytes = state.storageBlobs[`${bucket}/${path}`];
            if (!bytes) {
              return {
                data: null,
                error: { message: `not found: ${path}` },
              };
            }
            return {
              data: {
                async arrayBuffer() {
                  return bytes.buffer.slice(
                    bytes.byteOffset,
                    bytes.byteOffset + bytes.byteLength,
                  );
                },
              },
              error: null,
            };
          },
          async upload(path: string, data: Uint8Array, options?: unknown) {
            state.storageUploads.push({
              bucket,
              path,
              bytes: data,
              options,
            });
            const err = state.errors[`storage.${bucket}.upload`];
            if (err) return { data: null, error: err };
            return { data: { path }, error: null };
          },
          async remove(paths: string[]) {
            state.storageRemovals.push({ bucket, paths });
            const err = state.errors[`storage.${bucket}.remove`];
            if (err) return { data: null, error: err };
            for (const p of paths) delete state.storageBlobs[`${bucket}/${p}`];
            return {
              data: paths.map((name) => ({ name })),
              error: null,
            };
          },
        };
      },
    },
    async rpc(name: string, args: unknown) {
      state.rpcCalls.push({ name, args });
      const err = state.errors[`rpc.${name}`];
      if (err) return { data: null, error: err };
      return { data: null, error: null };
    },
  };

  return {
    client,
    state,
    seed(table, rows) {
      state.rows[table] = state.rows[table] ?? [];
      state.rows[table].push(...rows);
    },
    seedBlob(key, bytes) {
      state.storageBlobs[key] = bytes;
    },
    setError(key, err) {
      state.errors[key] = err;
    },
  };
}

export function makeAuthedFake(userId = "user-1") {
  return {
    auth: {
      async getUser() {
        return { data: { user: { id: userId } }, error: null };
      },
    },
  };
}

export function makeUnauthedFake() {
  return {
    auth: {
      async getUser() {
        return { data: { user: null }, error: { message: "no session" } };
      },
    },
  };
}
