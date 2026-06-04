import { describe, it, expect, vi, beforeEach } from "vitest";

// Storage cleanup runs on the service-role client; mock it so we can capture
// exactly which paths get removed from which bucket.
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));

import { purgeJobStorage } from "./purge";
import { createServiceClient } from "@/lib/supabase-api";

type Row = Record<string, unknown>;

// A minimal authed (user) client: `.from(table).select().eq()` awaits to the
// rows seeded for that table. Mirrors the chainable stub in
// jobs-with-cover.test.ts — only the methods purge actually calls are wired.
function fakeAuthedClient(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          rows = rows.filter((r) => r[col] === val);
          return builder;
        },
        then: (resolve: (r: { data: Row[]; error: null }) => unknown) =>
          resolve({ data: rows, error: null }),
      };
      return builder;
    },
  } as unknown as Parameters<typeof purgeJobStorage>[0];
}

// A service client whose storage.remove records (bucket, paths) per call.
function recordingService() {
  const removals: { bucket: string; paths: string[] }[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        return {
          async remove(paths: string[]) {
            removals.push({ bucket, paths });
            return { data: paths.map((name) => ({ name })), error: null };
          },
        };
      },
    },
  };
  return { client, removals };
}

beforeEach(() => vi.clearAllMocks());

describe("purgeJobStorage — photo storage cleanup", () => {
  it("removes each photo's original and annotated paths from the photos bucket, ignoring any legacy thumbnail_path (#411)", async () => {
    const { client, removals } = recordingService();
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const authed = fakeAuthedClient({
      photos: [
        {
          job_id: "job-1",
          storage_path: "job-1/p-1.jpg",
          annotated_path: "job-1/p-1-annot.jpg",
          // photos.thumbnail_path is dead (#411). Even if the column ever held
          // a value, purge must not treat it as a storage object to delete.
          thumbnail_path: "job-1/p-1-thumb.jpg",
        },
      ],
    });

    const result = await purgeJobStorage(authed, "job-1");

    expect(removals.find((r) => r.bucket === "photos")?.paths).toEqual([
      "job-1/p-1.jpg",
      "job-1/p-1-annot.jpg",
    ]);
    expect(result.storageRemoved).toBe(2);
  });

  it("still removes expense receipt and thumbnail paths from the receipts bucket (expenses.thumbnail_path is untouched)", async () => {
    const { client, removals } = recordingService();
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const authed = fakeAuthedClient({
      expenses: [
        {
          job_id: "job-1",
          receipt_path: "job-1/exp-1.jpg",
          thumbnail_path: "job-1/exp-1-thumb.jpg",
        },
      ],
    });

    await purgeJobStorage(authed, "job-1");

    expect(removals.find((r) => r.bucket === "receipts")?.paths).toEqual([
      "job-1/exp-1.jpg",
      "job-1/exp-1-thumb.jpg",
    ]);
  });
});
