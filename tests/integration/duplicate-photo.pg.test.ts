// Issue #519 — Duplicate (clean same-Job copy). Integration test for the
// `duplicate_photo` RPC (the deep module behind the Duplicate ⋯ More action),
// driven against a real Postgres via the embedded-postgres harness. The
// endpoint copies the clean original blob in Storage and hands the new path to
// this function, which writes the new Photo row + re-links its tags.
//
// Mirrors the embedded-postgres pattern in apply-template.pg.test.ts: boot a
// throwaway cluster in beforeAll, load the focused schema + the LIVE
// migration-519 function, drive queries through a raw pg client.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

import EmbeddedPostgres from "embedded-postgres";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCHEMA_SQL = readFileSync(
  join(process.cwd(), "tests", "integration", "duplicate-photo-schema.sql"),
  "utf8",
);
const MIGRATION_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-519-duplicate-photo.sql"),
  "utf8",
);

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

let pgServer: EmbeddedPostgres;
let dataDir: string;
let client: Client;

const TEST_DB = "duplicate_photo_test";

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "nookleus-pg-"));
  pgServer = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: await freePort(),
    user: "postgres",
    password: "postgres",
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });

  await pgServer.initialise();
  await pgServer.start();
  await pgServer.createDatabase(TEST_DB);

  client = pgServer.getPgClient(TEST_DB);
  await client.connect();

  await client.query(
    "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF; END $$;",
  );
  await client.query(SCHEMA_SQL);
  await client.query(MIGRATION_SQL);
}, 120_000);

afterAll(async () => {
  if (client) await client.end().catch(() => {});
  if (pgServer) await pgServer.stop().catch(() => {});
  if (dataDir) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* best-effort temp-dir cleanup */
    }
  }
});

interface PhotoRow {
  id: string;
  job_id: string;
  storage_path: string;
  annotated_path: string | null;
  caption: string | null;
  taken_at: string | null;
  taken_by: string;
  media_type: string;
  file_size: number | null;
  width: number | null;
  height: number | null;
  before_after_pair_id: string | null;
  before_after_role: string | null;
  organization_id: string;
  uploaded_from: string;
  client_capture_id: string | null;
}

/** Seed one source Photo, returning its row. Overrides patch the defaults. */
async function seedPhoto(
  fields: Partial<PhotoRow> & { job_id?: string; organization_id?: string } = {},
): Promise<PhotoRow> {
  const row = {
    job_id: fields.job_id ?? randomUUID(),
    organization_id: fields.organization_id ?? randomUUID(),
    storage_path: fields.storage_path ?? `org/job/${randomUUID()}.jpg`,
    annotated_path: fields.annotated_path ?? null,
    caption: fields.caption ?? null,
    taken_at: fields.taken_at ?? null,
    taken_by: fields.taken_by ?? "Eric",
    media_type: fields.media_type ?? "photo",
    file_size: fields.file_size ?? null,
    width: fields.width ?? null,
    height: fields.height ?? null,
    before_after_pair_id: fields.before_after_pair_id ?? null,
    before_after_role: fields.before_after_role ?? null,
    uploaded_from: fields.uploaded_from ?? "web",
    client_capture_id: fields.client_capture_id ?? null,
  };
  const { rows } = await client.query<PhotoRow>(
    `INSERT INTO photos (
       job_id, organization_id, storage_path, annotated_path, caption,
       taken_at, taken_by, media_type, file_size, width, height,
       before_after_pair_id, before_after_role, uploaded_from, client_capture_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      row.job_id, row.organization_id, row.storage_path, row.annotated_path, row.caption,
      row.taken_at, row.taken_by, row.media_type, row.file_size, row.width, row.height,
      row.before_after_pair_id, row.before_after_role, row.uploaded_from, row.client_capture_id,
    ],
  );
  return rows[0];
}

/** Seed a tag in an org and return its id. */
async function seedTag(orgId: string, name: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO photo_tags (organization_id, name) VALUES ($1, $2) RETURNING id",
    [orgId, name],
  );
  return rows[0].id;
}

/** Assign a tag to a photo. */
async function assignTag(orgId: string, photoId: string, tagId: string): Promise<void> {
  await client.query(
    "INSERT INTO photo_tag_assignments (organization_id, photo_id, tag_id) VALUES ($1, $2, $3)",
    [orgId, photoId, tagId],
  );
}

/** The tag ids assigned to a photo. */
async function tagIdsOf(photoId: string): Promise<string[]> {
  const { rows } = await client.query<{ tag_id: string }>(
    "SELECT tag_id FROM photo_tag_assignments WHERE photo_id = $1 ORDER BY tag_id",
    [photoId],
  );
  return rows.map((r) => r.tag_id);
}

/** Call the function under test, returning the new Photo row. */
async function duplicatePhoto(sourceId: string, newPath: string): Promise<PhotoRow> {
  const { rows } = await client.query<PhotoRow>(
    "SELECT * FROM duplicate_photo($1, $2)",
    [sourceId, newPath],
  );
  return rows[0];
}

describe("duplicate_photo — new row in the same Job", () => {
  it("inserts exactly one new Photo row in the source's Job", async () => {
    const source = await seedPhoto();
    const newPath = `org/job/${randomUUID()}.jpg`;

    const copy = await duplicatePhoto(source.id, newPath);

    // A distinct row…
    expect(copy.id).not.toBe(source.id);
    // …in the same Job…
    expect(copy.job_id).toBe(source.job_id);
    expect(copy.organization_id).toBe(source.organization_id);
    // …carrying the path the endpoint copied the clean original to.
    expect(copy.storage_path).toBe(newPath);

    // Exactly one new row landed in that Job (source + copy).
    const { rows } = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM photos WHERE job_id = $1",
      [source.job_id],
    );
    expect(Number(rows[0].count)).toBe(2);
  });
});

describe("duplicate_photo — preserves the Photo's fields", () => {
  it("carries the caption over to the copy", async () => {
    const source = await seedPhoto({ caption: "Roof damage to NE corner" });

    const copy = await duplicatePhoto(source.id, `org/job/${randomUUID()}.jpg`);

    expect(copy.caption).toBe("Roof damage to NE corner");
  });

  it("keeps the Before/After role and its pairing link", async () => {
    const partnerId = randomUUID();
    const source = await seedPhoto({
      before_after_role: "after",
      before_after_pair_id: partnerId,
    });

    const copy = await duplicatePhoto(source.id, `org/job/${randomUUID()}.jpg`);

    expect(copy.before_after_role).toBe("after");
    expect(copy.before_after_pair_id).toBe(partnerId);
  });
});

describe("duplicate_photo — clean original, never the drawings", () => {
  it("copies as a clean original: the given path, and annotated_path is NULL even when the source was drawn on", async () => {
    const source = await seedPhoto({
      storage_path: "org/job/original.jpg",
      annotated_path: "org/job/original-annotated.png",
    });
    const newPath = `org/job/${randomUUID()}.jpg`;

    const copy = await duplicatePhoto(source.id, newPath);

    // The duplicate points at the freshly-copied original, not the source's
    // path and never the annotation render.
    expect(copy.storage_path).toBe(newPath);
    expect(copy.annotated_path).toBeNull();
  });

  it("preserves the media kind and dimensions so a duplicated video stays a playable video", async () => {
    const source = await seedPhoto({
      media_type: "video",
      storage_path: "org/job/clip.mp4",
      file_size: 1_048_576,
      width: 1920,
      height: 1080,
      taken_by: "Jordan",
      taken_at: "2026-05-01T15:30:00.000Z",
    });

    const copy = await duplicatePhoto(source.id, "org/job/clip-copy.mp4");

    expect(copy.media_type).toBe("video");
    expect(copy.width).toBe(1920);
    expect(copy.height).toBe(1080);
    expect(copy.file_size).toBe(1_048_576);
    expect(copy.taken_by).toBe("Jordan");
    expect(new Date(copy.taken_at as string).toISOString()).toBe(
      "2026-05-01T15:30:00.000Z",
    );
  });
});

describe("duplicate_photo — re-links the source's tags", () => {
  it("assigns the copy the same tags (ids + org) the source carried", async () => {
    const orgId = randomUUID();
    const source = await seedPhoto({ organization_id: orgId });
    const roof = await seedTag(orgId, "Roof");
    const water = await seedTag(orgId, "Water Damage");
    await assignTag(orgId, source.id, roof);
    await assignTag(orgId, source.id, water);

    const copy = await duplicatePhoto(source.id, `org/job/${randomUUID()}.jpg`);

    // The copy carries exactly the source's tags — same ids…
    expect(await tagIdsOf(copy.id)).toEqual([roof, water].sort());
    // …each stamped with the same organization.
    const { rows } = await client.query<{ organization_id: string }>(
      "SELECT organization_id FROM photo_tag_assignments WHERE photo_id = $1",
      [copy.id],
    );
    expect(rows.every((r) => r.organization_id === orgId)).toBe(true);
    // The source keeps its own assignments untouched.
    expect(await tagIdsOf(source.id)).toEqual([roof, water].sort());
  });

  it("leaves the copy untagged when the source had no tags", async () => {
    const source = await seedPhoto();

    const copy = await duplicatePhoto(source.id, `org/job/${randomUUID()}.jpg`);

    expect(await tagIdsOf(copy.id)).toEqual([]);
  });
});
