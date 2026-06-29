import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  starRatingToInt,
  mapReviewToRow,
  fetchLocationReviews,
  listReviewLocations,
  upsertReviews,
  syncOrganizationReviews,
  listOrganizationReviews,
  syncAllConnectedReviews,
  postReviewReply,
  markReviewReplied,
  type GoogleApiReview,
  type GoogleReviewUpsert,
  type GoogleReviewInboxItem,
} from "./reviews";

// The Google Business Profile review payload (legacy My Business v4 reviews
// endpoint). Reviews are per-location; the inbox is org-scoped, so the mapper
// is handed both the Organization and the location resource name the review
// came from.
function makeApiReview(overrides: Partial<GoogleApiReview> = {}): GoogleApiReview {
  return {
    reviewId: "rev-1",
    reviewer: { displayName: "Jane Doe", profilePhotoUrl: "https://g/p.jpg" },
    starRating: "FIVE",
    comment: "Great service",
    createTime: "2026-06-01T12:00:00Z",
    updateTime: "2026-06-01T12:00:00Z",
    ...overrides,
  };
}

const LOCATION = "accounts/123/locations/456";

describe("starRatingToInt", () => {
  it("maps the ONE..FIVE word enum to 1..5", () => {
    expect(starRatingToInt("ONE")).toBe(1);
    expect(starRatingToInt("TWO")).toBe(2);
    expect(starRatingToInt("THREE")).toBe(3);
    expect(starRatingToInt("FOUR")).toBe(4);
    expect(starRatingToInt("FIVE")).toBe(5);
  });

  it("maps an unspecified or unknown rating to 0", () => {
    expect(starRatingToInt("STAR_RATING_UNSPECIFIED")).toBe(0);
    expect(starRatingToInt(undefined)).toBe(0);
    expect(starRatingToInt("banana")).toBe(0);
  });
});

describe("mapReviewToRow", () => {
  it("maps a Google review payload onto a local upsert row", () => {
    const row = mapReviewToRow({
      organizationId: "org-1",
      locationName: LOCATION,
      review: makeApiReview(),
    });

    expect(row.organization_id).toBe("org-1");
    expect(row.google_review_id).toBe("rev-1");
    expect(row.location_name).toBe(LOCATION);
    expect(row.reviewer_name).toBe("Jane Doe");
    expect(row.reviewer_photo_url).toBe("https://g/p.jpg");
    expect(row.star_rating).toBe(5);
    expect(row.comment).toBe("Great service");
    expect(row.review_created_at).toBe("2026-06-01T12:00:00Z");
    expect(row.review_updated_at).toBe("2026-06-01T12:00:00Z");
  });

  it("flags a review with no reply as unreplied (replied=false, null reply fields)", () => {
    const row = mapReviewToRow({
      organizationId: "org-1",
      locationName: LOCATION,
      review: makeApiReview(),
    });
    expect(row.replied).toBe(false);
    expect(row.reply_comment).toBeNull();
    expect(row.reply_updated_at).toBeNull();
  });

  it("derives replied state from the review's reply on Google", () => {
    const row = mapReviewToRow({
      organizationId: "org-1",
      locationName: LOCATION,
      review: makeApiReview({
        reviewReply: { comment: "Thanks!", updateTime: "2026-06-02T08:00:00Z" },
      }),
    });
    expect(row.replied).toBe(true);
    expect(row.reply_comment).toBe("Thanks!");
    expect(row.reply_updated_at).toBe("2026-06-02T08:00:00Z");
  });

  it("tolerates a star-only review (no comment, anonymous reviewer)", () => {
    const row = mapReviewToRow({
      organizationId: "org-1",
      locationName: LOCATION,
      review: makeApiReview({
        reviewer: { isAnonymous: true },
        comment: undefined,
        starRating: "FOUR",
      }),
    });
    expect(row.comment).toBeNull();
    expect(row.reviewer_name).toBeNull();
    expect(row.reviewer_photo_url).toBeNull();
    expect(row.star_rating).toBe(4);
  });
});

// A fake authorized client: the reviews fetch layer only needs `.fetch`, which
// the real GoogleClient injects a bearer token into. `handler` routes a URL to
// a JSON body; every call is recorded so tests can assert on paging requests.
function makeClient(handler: (url: string) => unknown) {
  const calls: string[] = [];
  const client = {
    fetch: async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      return new Response(JSON.stringify(handler(url) ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
  return { client, calls };
}

describe("fetchLocationReviews", () => {
  it("fetches a single page of reviews for a location", async () => {
    const { client, calls } = makeClient(() => ({
      reviews: [makeApiReview({ reviewId: "a" }), makeApiReview({ reviewId: "b" })],
    }));

    const reviews = await fetchLocationReviews(client, LOCATION);

    expect(reviews.map((r) => r.reviewId)).toEqual(["a", "b"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(LOCATION);
    expect(calls[0]).toContain("/reviews");
  });

  it("follows nextPageToken until every page is drained", async () => {
    const { client, calls } = makeClient((url) =>
      url.includes("pageToken=p2")
        ? { reviews: [makeApiReview({ reviewId: "b" })] }
        : { reviews: [makeApiReview({ reviewId: "a" })], nextPageToken: "p2" },
    );

    const reviews = await fetchLocationReviews(client, LOCATION);

    expect(reviews.map((r) => r.reviewId)).toEqual(["a", "b"]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("pageToken=p2");
  });

  it("returns an empty array when the location has no reviews", async () => {
    const { client } = makeClient(() => ({}));
    expect(await fetchLocationReviews(client, LOCATION)).toEqual([]);
  });
});

// A reply-capturing client: records the (url, init) of each call and returns a
// JSON response with a configurable status/body, so a test can assert the HTTP
// method and request body postReviewReply sends to Google's updateReply endpoint.
function makeReplyClient(opts: { status?: number; body?: unknown } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const client = {
    fetch: async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(opts.body ?? {}), {
        status: opts.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
  return { client, calls };
}

describe("postReviewReply", () => {
  it("PUTs the comment to the review's reply endpoint", async () => {
    const { client, calls } = makeReplyClient();

    await postReviewReply(client, LOCATION, "rev-1", "Thanks for the kind words!");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `https://mybusiness.googleapis.com/v4/${LOCATION}/reviews/rev-1/reply`,
    );
    expect(calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      comment: "Thanks for the kind words!",
    });
  });

  it("throws when Google rejects the reply (failure surfaced, not swallowed)", async () => {
    const { client } = makeReplyClient({ status: 403 });

    await expect(
      postReviewReply(client, LOCATION, "rev-1", "Thanks!"),
    ).rejects.toThrow(/403/);
  });

  it("returns the reply updateTime from Google's response", async () => {
    const { client } = makeReplyClient({
      body: { comment: "Thanks!", updateTime: "2026-06-29T10:00:00Z" },
    });

    const result = await postReviewReply(client, LOCATION, "rev-1", "Thanks!");

    expect(result).toEqual({ updateTime: "2026-06-29T10:00:00Z" });
  });
});

// A mutable google_review fake supporting the update(...).eq(...).eq(...) chain
// markReviewReplied uses. Applies the update to every seeded row that matches
// all chained eq filters when the chain is awaited, so a test can assert which
// rows changed — exactly the org-scoping the helper must enforce.
function makeUpdatableReviewDb(seed: Array<Record<string, unknown>>) {
  const rows = seed.map((r) => ({ ...r }));
  const client = {
    from(table: string) {
      if (table !== "google_review") throw new Error(`unexpected table: ${table}`);
      return {
        update(values: Record<string, unknown>) {
          const filters: Array<[string, unknown]> = [];
          const api = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return api;
            },
            then(onFulfilled: (r: { error: null }) => unknown) {
              for (const row of rows) {
                if (filters.every(([c, v]) => row[c] === v)) {
                  Object.assign(row, values);
                }
              }
              return Promise.resolve({ error: null }).then(onFulfilled);
            },
          };
          return api;
        },
      };
    },
  };
  return { db: client as unknown as SupabaseClient, rows: () => rows };
}

describe("markReviewReplied", () => {
  it("flips the row to replied with the comment and update time, scoped to the org", async () => {
    const fake = makeUpdatableReviewDb([
      {
        id: "row-1",
        organization_id: "org-1",
        replied: false,
        reply_comment: null,
        reply_updated_at: null,
      },
    ]);

    await markReviewReplied(
      fake.db,
      "org-1",
      "row-1",
      "Thank you, Pat!",
      "2026-06-29T10:00:00Z",
    );

    const row = fake.rows().find((r) => r.id === "row-1")!;
    expect(row.replied).toBe(true);
    expect(row.reply_comment).toBe("Thank you, Pat!");
    expect(row.reply_updated_at).toBe("2026-06-29T10:00:00Z");
  });

  it("does not touch a row belonging to another organization", async () => {
    const fake = makeUpdatableReviewDb([
      {
        id: "row-1",
        organization_id: "org-2",
        replied: false,
        reply_comment: null,
        reply_updated_at: null,
      },
    ]);

    await markReviewReplied(
      fake.db,
      "org-1",
      "row-1",
      "Thanks!",
      "2026-06-29T10:00:00Z",
    );

    const row = fake.rows().find((r) => r.id === "row-1")!;
    expect(row.replied).toBe(false);
    expect(row.reply_comment).toBeNull();
  });
});

describe("listReviewLocations", () => {
  it("combines each account with its locations into v4 resource names", async () => {
    const { client, calls } = makeClient((url) => {
      if (url.includes("accountmanagement")) {
        return { accounts: [{ name: "accounts/123" }] };
      }
      if (url.includes("businessinformation")) {
        return { locations: [{ name: "locations/456" }, { name: "locations/789" }] };
      }
      return {};
    });

    const locations = await listReviewLocations(client);

    expect(locations).toEqual([
      "accounts/123/locations/456",
      "accounts/123/locations/789",
    ]);
    // The Business Information locations endpoint requires a readMask.
    const locationsCall = calls.find((u) => u.includes("businessinformation"));
    expect(locationsCall).toContain("readMask");
    expect(locationsCall).toContain("accounts/123/locations");
  });

  it("pages through locations via nextPageToken", async () => {
    const { client } = makeClient((url) => {
      if (url.includes("accountmanagement")) {
        return { accounts: [{ name: "accounts/123" }] };
      }
      if (url.includes("businessinformation")) {
        return url.includes("pageToken=next")
          ? { locations: [{ name: "locations/789" }] }
          : { locations: [{ name: "locations/456" }], nextPageToken: "next" };
      }
      return {};
    });

    const locations = await listReviewLocations(client);

    expect(locations).toEqual([
      "accounts/123/locations/456",
      "accounts/123/locations/789",
    ]);
  });
});

// In-memory google_review fake. Keys rows by the conflict columns the store
// claims to use (parsed from onConflict) so an upsert with the same key
// REPLACES rather than appends — this is exactly what proves idempotency.
function makeReviewDb() {
  const store = new Map<string, Record<string, unknown>>();
  let lastOnConflict: string | undefined;
  let upsertCalls = 0;

  const client = {
    from(table: string) {
      if (table !== "google_review") throw new Error(`unexpected table: ${table}`);
      return {
        async upsert(rows: Record<string, unknown>[], opts?: { onConflict?: string }) {
          upsertCalls += 1;
          lastOnConflict = opts?.onConflict;
          const cols = (opts?.onConflict ?? "").split(",").map((c) => c.trim());
          for (const row of rows) {
            const key = cols.map((c) => String(row[c])).join("|");
            store.set(key, { ...row });
          }
          return { data: null, error: null };
        },
      };
    },
  };

  return {
    db: client as unknown as SupabaseClient,
    rows: () => [...store.values()] as unknown as GoogleReviewUpsert[],
    get lastOnConflict() {
      return lastOnConflict;
    },
    get upsertCalls() {
      return upsertCalls;
    },
  };
}

// A whole-pipeline client: drives the real listReviewLocations +
// fetchLocationReviews helpers off a mutable `data` object so a test can change
// what Google reports between two syncs (e.g. an owner posting a reply).
function makeSyncClient(data: {
  account?: string;
  locations: string[];
  reviews: Record<string, GoogleApiReview[]>;
}) {
  const account = data.account ?? "accounts/123";
  return makeClient((url) => {
    if (url.includes("accountmanagement")) {
      return { accounts: [{ name: account }] };
    }
    if (url.includes("businessinformation")) {
      return {
        locations: data.locations.map((full) => ({
          name: full.slice(account.length + 1),
        })),
      };
    }
    const loc = data.locations.find((l) => url.includes(l));
    return { reviews: loc ? data.reviews[loc] ?? [] : [] };
  }).client;
}

describe("upsertReviews", () => {
  it("upserts on the (organization_id, google_review_id) conflict target", async () => {
    const fake = makeReviewDb();
    const rows = [
      mapReviewToRow({ organizationId: "org-1", locationName: LOCATION, review: makeApiReview() }),
    ];

    await upsertReviews(fake.db, rows);

    expect(fake.lastOnConflict).toBe("organization_id,google_review_id");
    expect(fake.rows()).toHaveLength(1);
  });

  it("does not touch the table for an empty batch", async () => {
    const fake = makeReviewDb();
    await upsertReviews(fake.db, []);
    expect(fake.upsertCalls).toBe(0);
    expect(fake.rows()).toHaveLength(0);
  });
});

describe("syncOrganizationReviews", () => {
  it("re-syncing the same reviews never duplicates or regresses (idempotent)", async () => {
    const fake = makeReviewDb();
    const data = {
      locations: [LOCATION],
      reviews: { [LOCATION]: [makeApiReview({ reviewId: "rev-1" })] },
    };
    const client = makeSyncClient(data);

    await syncOrganizationReviews({ db: fake.db, organizationId: "org-1", client });
    await syncOrganizationReviews({ db: fake.db, organizationId: "org-1", client });

    const rows = fake.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0].google_review_id).toBe("rev-1");
    expect(rows[0].replied).toBe(false);
  });

  it("flips a review from unreplied to replied across syncs", async () => {
    const fake = makeReviewDb();
    const data = {
      locations: [LOCATION],
      reviews: { [LOCATION]: [makeApiReview({ reviewId: "rev-1", reviewReply: undefined })] },
    };
    const client = makeSyncClient(data);

    await syncOrganizationReviews({ db: fake.db, organizationId: "org-1", client });
    expect(fake.rows()[0].replied).toBe(false);
    expect(fake.rows()[0].reply_comment).toBeNull();

    // The owner replies on Google; the next poll observes it.
    data.reviews[LOCATION] = [
      makeApiReview({
        reviewId: "rev-1",
        reviewReply: { comment: "Thanks!", updateTime: "2026-06-02T08:00:00Z" },
      }),
    ];
    await syncOrganizationReviews({ db: fake.db, organizationId: "org-1", client });

    const rows = fake.rows();
    expect(rows).toHaveLength(1); // upserted in place, not duplicated
    expect(rows[0].replied).toBe(true);
    expect(rows[0].reply_comment).toBe("Thanks!");
    expect(rows[0].reply_updated_at).toBe("2026-06-02T08:00:00Z");
  });

  it("reports how many locations and reviews it synced", async () => {
    const fake = makeReviewDb();
    const data = {
      locations: [LOCATION],
      reviews: {
        [LOCATION]: [makeApiReview({ reviewId: "a" }), makeApiReview({ reviewId: "b" })],
      },
    };
    const client = makeSyncClient(data);

    const result = await syncOrganizationReviews({
      db: fake.db,
      organizationId: "org-1",
      client,
    });

    expect(result).toEqual({ locations: 1, reviewsSynced: 2 });
  });
});

// A seeded, read-only google_review fake for the inbox read path. Models just
// the chain listOrganizationReviews uses: select(cols).eq("organization_id", x)
// resolving (as a thenable, like the real query builder) to the filtered rows.
// `.order()` is deliberately NOT modelled — the read layer sorts client-side, so
// the ordering it returns is its own, not Postgres's.
function makeInboxDb(seed: Array<Partial<GoogleReviewInboxItem> & { organization_id?: string }>) {
  const rows = seed.map((r, i) => ({
    id: r.id ?? `row-${i}`,
    google_review_id: r.google_review_id ?? `rev-${i}`,
    location_name: r.location_name ?? LOCATION,
    reviewer_name: r.reviewer_name ?? null,
    reviewer_photo_url: r.reviewer_photo_url ?? null,
    star_rating: r.star_rating ?? 0,
    comment: r.comment ?? null,
    review_created_at: r.review_created_at ?? null,
    replied: r.replied ?? false,
    reply_comment: r.reply_comment ?? null,
    reply_updated_at: r.reply_updated_at ?? null,
    organization_id: r.organization_id ?? "org-1",
  }));

  const client = {
    from(table: string) {
      if (table !== "google_review") throw new Error(`unexpected table: ${table}`);
      return {
        select() {
          const filters: Array<[string, unknown]> = [];
          const api = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return api;
            },
            then(onFulfilled: (r: { data: unknown[]; error: null }) => unknown) {
              const data = rows.filter((row) =>
                filters.every(
                  ([col, val]) => (row as Record<string, unknown>)[col] === val,
                ),
              );
              return Promise.resolve({ data, error: null }).then(onFulfilled);
            },
          };
          return api;
        },
      };
    },
  };

  return { db: client as unknown as SupabaseClient };
}

describe("listOrganizationReviews", () => {
  it("returns only the named organization's reviews", async () => {
    const { db } = makeInboxDb([
      { id: "a", organization_id: "org-1", google_review_id: "rev-a" },
      { id: "b", organization_id: "org-2", google_review_id: "rev-b" },
    ]);

    const items = await listOrganizationReviews(db, "org-1");

    expect(items.map((i) => i.id)).toEqual(["a"]);
  });

  it("lists unreplied reviews before replied ones, newest first within each group", async () => {
    const { db } = makeInboxDb([
      { id: "replied-new", replied: true, review_created_at: "2026-06-10T00:00:00Z" },
      { id: "unreplied-old", replied: false, review_created_at: "2026-06-01T00:00:00Z" },
      { id: "unreplied-new", replied: false, review_created_at: "2026-06-05T00:00:00Z" },
      { id: "replied-old", replied: true, review_created_at: "2026-06-02T00:00:00Z" },
    ]);

    const items = await listOrganizationReviews(db, "org-1");

    expect(items.map((i) => i.id)).toEqual([
      "unreplied-new",
      "unreplied-old",
      "replied-new",
      "replied-old",
    ]);
  });

  it("sorts a review with no created date last within its group and carries the replied flag", async () => {
    const { db } = makeInboxDb([
      { id: "no-date", replied: false, review_created_at: null },
      { id: "has-date", replied: false, review_created_at: "2026-06-01T00:00:00Z" },
    ]);

    const items = await listOrganizationReviews(db, "org-1");

    expect(items.map((i) => i.id)).toEqual(["has-date", "no-date"]);
    expect(items.every((i) => i.replied === false)).toBe(true);
  });

  it("returns an empty list when the organization has no reviews", async () => {
    const { db } = makeInboxDb([{ id: "x", organization_id: "other-org" }]);
    expect(await listOrganizationReviews(db, "org-1")).toEqual([]);
  });
});

describe("syncAllConnectedReviews", () => {
  it("syncs every connected org and totals the reviews upserted", async () => {
    const fake = makeReviewDb();
    const locA = "accounts/1/locations/a";
    const locB = "accounts/2/locations/b";
    const clients: Record<string, ReturnType<typeof makeSyncClient>> = {
      "org-a": makeSyncClient({
        account: "accounts/1",
        locations: [locA],
        reviews: { [locA]: [makeApiReview({ reviewId: "a1" })] },
      }),
      "org-b": makeSyncClient({
        account: "accounts/2",
        locations: [locB],
        reviews: {
          [locB]: [makeApiReview({ reviewId: "b1" }), makeApiReview({ reviewId: "b2" })],
        },
      }),
    };

    const result = await syncAllConnectedReviews({
      db: fake.db,
      organizationIds: ["org-a", "org-b"],
      getClient: async (orgId) => clients[orgId] ?? null,
    });

    expect(result).toEqual({
      organizations: 2,
      synced: 2,
      skipped: 0,
      failed: 0,
      reviewsSynced: 3,
    });
    expect(fake.rows()).toHaveLength(3);
  });

  it("skips an org whose connection yields no client (broken / disconnected)", async () => {
    const fake = makeReviewDb();
    const loc = "accounts/1/locations/a";
    const client = makeSyncClient({
      account: "accounts/1",
      locations: [loc],
      reviews: { [loc]: [makeApiReview({ reviewId: "a1" })] },
    });

    const result = await syncAllConnectedReviews({
      db: fake.db,
      organizationIds: ["org-broken", "org-ok"],
      getClient: async (orgId) => (orgId === "org-ok" ? client : null),
    });

    expect(result.skipped).toBe(1);
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.reviewsSynced).toBe(1);
  });

  it("isolates a failing org so the rest still sync", async () => {
    const fake = makeReviewDb();
    const loc = "accounts/1/locations/a";
    const okClient = makeSyncClient({
      account: "accounts/1",
      locations: [loc],
      reviews: { [loc]: [makeApiReview({ reviewId: "a1" })] },
    });
    const throwingClient = {
      fetch: async () => {
        throw new Error("boom");
      },
    };

    const result = await syncAllConnectedReviews({
      db: fake.db,
      organizationIds: ["org-bad", "org-ok"],
      getClient: async (orgId) => (orgId === "org-ok" ? okClient : throwingClient),
    });

    expect(result.failed).toBe(1);
    expect(result.synced).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.reviewsSynced).toBe(1);
    expect(fake.rows()).toHaveLength(1);
  });

  it("returns zeros when there are no connected orgs", async () => {
    const fake = makeReviewDb();
    const result = await syncAllConnectedReviews({
      db: fake.db,
      organizationIds: [],
      getClient: async () => null,
    });

    expect(result).toEqual({
      organizations: 0,
      synced: 0,
      skipped: 0,
      failed: 0,
      reviewsSynced: 0,
    });
  });
});
