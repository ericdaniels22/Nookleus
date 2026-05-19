// Behavioral Service-client fake for the notifications route tests (#119).
//
// The notifications route runs through `withRequestContext({ serviceClient:
// true })`, so the route bodies read and write through the Service client.
// Unlike the shared no-op `fakeServiceClient`, this fake actually applies
// `update()`s to the seeded rows — the #119 fix is about *which* rows a
// caller's read/write reaches, so a test must be able to observe that a
// mutation hit only the caller's own notifications and never another
// user's. The seeded array is held by reference; inspect it after the call.
//
// Covers only the surface the two route bodies touch: a chainable
// select / eq / order / limit / update builder. `eq` narrows rows; an
// awaited builder resolves `{ data, error, count }`, applying any recorded
// `update` payload to the narrowed rows first.

type Row = Record<string, unknown>;

function builder(rows: Row[]): Record<string, unknown> {
  let filtered = [...rows];
  let updatePayload: Row | null = null;
  const b: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit"]) {
    b[m] = () => b;
  }
  b.update = (payload: Row) => {
    updatePayload = payload;
    return b;
  };
  b.eq = (col: string, val: unknown) => {
    filtered = filtered.filter((r) => r[col] === val);
    return b;
  };
  b.then = (
    resolve: (v: { data: Row[]; error: null; count: number }) => unknown,
  ) => {
    if (updatePayload) {
      for (const r of filtered) Object.assign(r, updatePayload);
    }
    return resolve({ data: filtered, error: null, count: filtered.length });
  };
  return b;
}

// A fake Service client for the notifications route bodies. `notifications`
// seeds the rows the route reads and writes; the array is held by
// reference so a test can assert which rows were (and were not) marked
// read after a PATCH.
export function fakeNotificationsServiceClient(
  opts: { notifications?: Row[] } = {},
) {
  const tables: Record<string, Row[]> = {
    notifications: opts.notifications ?? [],
  };
  return {
    from(table: string) {
      return builder(tables[table] ?? []);
    },
  };
}
