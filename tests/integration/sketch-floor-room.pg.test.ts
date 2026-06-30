// Integration coverage for the Sketch / Floor / Room persistence layer —
// migration-build88-sketch-floor-room.sql (#860, ADR 0024). This is M5.
//
// Harness. The repo's blessed integration harness boots Supabase via
// `supabase start` (Docker + virtualization), unavailable here. The thing under
// test is plain DDL + RLS, so we boot a throwaway embedded-postgres cluster,
// load a focused schema + the LIVE migration SQL verbatim (no copy-paste drift),
// and drive it through a raw `pg` client. Nothing touches the network, Docker,
// or the local PG service. Run with `npm run test:pg`.
//
// What's pinned here:
//   - the Sketch → Floor → Room round-trip, with M1's cached measurements
//     surviving the trip (the round-trip ties M1 ↔ M5: the persisted cache
//     equals measureRoom()'s output);
//   - the 1:1 Sketch ↔ Job rule (UNIQUE(job_id));
//   - the org-isolation contract (tenant_isolation RLS via SET ROLE
//     authenticated, with active_organization_id() resolving from test.org).

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

import EmbeddedPostgres from "embedded-postgres";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  boundingBox,
  rectangleFootprint,
  type Point,
} from "../../src/lib/sketch/footprint";
import { measureFootprint, measureRoom } from "../../src/lib/sketch/measure-room";

const SCHEMA_SQL = readFileSync(
  join(process.cwd(), "tests", "integration", "sketch-floor-room-schema.sql"),
  "utf8",
);
const MIGRATION_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-build88-sketch-floor-room.sql"),
  "utf8",
);
// #879 adds rooms.footprint and backfills existing rectangles. Loaded verbatim,
// in order, on top of build88 — the live up-migration, never a copy.
const MIGRATION_89_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-build89-room-footprint.sql"),
  "utf8",
);

/**
 * The DROP statements from migration-build88's `-- ROLLBACK` block, uncommented.
 * Lets the rollback test run the LIVE down-migration verbatim instead of a
 * hand-copied duplicate that could drift from the comment.
 */
function rollbackSql(): string {
  const lines = MIGRATION_SQL.split("\n");
  const start = lines.findIndex((l) => /--\s*ROLLBACK/.test(l));
  if (start === -1) throw new Error("migration-build88 has no ROLLBACK block");
  return lines
    .slice(start + 1)
    .map((l) => l.replace(/^--\s?/, "").trim())
    .filter((l) => /^DROP\b/i.test(l))
    .join("\n");
}

/** A free ephemeral port so the cluster never collides with a local 5432. */
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

const TEST_DB = "sketch_floor_room_test";

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

  // migration-build88's policies are `to authenticated` via the default role;
  // create the role Supabase provides but a bare cluster does not so the SQL
  // and its GRANTs load verbatim.
  await client.query(
    "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF; END $$;",
  );
  await client.query(SCHEMA_SQL);
  await client.query(MIGRATION_SQL);
  await client.query(MIGRATION_89_SQL);
  // The tables now exist — grant the RLS test caller the privileges it needs to
  // evaluate (and be filtered by) the tenant_isolation policies.
  await client.query(
    "GRANT SELECT, INSERT, UPDATE, DELETE ON public.sketches, public.floors, public.rooms TO authenticated;",
  );
}, 120_000);

afterAll(async () => {
  if (client) await client.end().catch(() => {});
  if (pgServer) await pgServer.stop().catch(() => {});
  if (dataDir) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* best-effort temp-dir cleanup; Windows may still hold a handle */
    }
  }
});

async function seedOrg(): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Org', 'org-' || $1) RETURNING id",
    [randomUUID()],
  );
  return rows[0].id;
}

async function seedJob(orgId: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO jobs (organization_id, job_number) VALUES ($1, $2) RETURNING id",
    [orgId, "JOB-" + randomUUID().slice(0, 8)],
  );
  return rows[0].id;
}

async function insertSketch(orgId: string, jobId: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO sketches (organization_id, job_id) VALUES ($1, $2) RETURNING id",
    [orgId, jobId],
  );
  return rows[0].id;
}

async function insertFloor(
  orgId: string,
  sketchId: string,
  name: string,
  defaultCeilingHeight: number,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO floors (organization_id, sketch_id, name, default_ceiling_height)
       VALUES ($1, $2, $3, $4) RETURNING id`,
    [orgId, sketchId, name, defaultCeilingHeight],
  );
  return rows[0].id;
}

/** Persist a Room from its footprint, with M1's measurements as the cached
 *  snapshot. The bounding box backfills the legacy width/length columns — the
 *  same contract the app's createSketchRoom() write path follows (#879). */
async function insertRoomFootprint(
  orgId: string,
  floorId: string,
  name: string,
  footprint: Point[],
  ceilingHeightOverride: number | null,
  effectiveCeilingHeight: number,
): Promise<string> {
  const m = measureFootprint({ footprint, ceilingHeight: effectiveCeilingHeight });
  const bbox = boundingBox(footprint);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO rooms (
       organization_id, floor_id, name, footprint, width, length,
       ceiling_height_override,
       floor_area, ceiling_area, perimeter, gross_wall_area, net_wall_area, volume
     ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [
      orgId,
      floorId,
      name,
      JSON.stringify(footprint), // jsonb wants a JSON string, not a PG array literal
      bbox.width,
      bbox.length,
      ceilingHeightOverride,
      m.floorArea,
      m.ceilingArea,
      m.perimeter,
      m.grossWallArea,
      m.netWallArea,
      m.volume,
    ],
  );
  return rows[0].id;
}

/** Persist a rectangular Room (#860 shape) — a 4-point footprint. */
async function insertRoom(
  orgId: string,
  floorId: string,
  name: string,
  dims: { width: number; length: number; ceilingHeightOverride: number | null },
  effectiveCeilingHeight: number,
): Promise<string> {
  return insertRoomFootprint(
    orgId,
    floorId,
    name,
    rectangleFootprint(dims.width, dims.length),
    dims.ceilingHeightOverride,
    effectiveCeilingHeight,
  );
}

/**
 * Run `fn` as a member of `orgId`: impersonate the `authenticated` role with the
 * active org resolved from the test.org GUC (the same GUC nookleus.active_organization_id()
 * reads), so the tenant_isolation policies actually fire. Always restores the
 * superuser owner + clears the GUC, even if `fn` throws.
 */
async function asOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  await client.query("SELECT set_config('test.org', $1, false)", [orgId]);
  await client.query("SET ROLE authenticated");
  try {
    return await fn();
  } finally {
    await client.query("RESET ROLE");
    await client.query("SELECT set_config('test.org', '', false)");
  }
}

describe("sketch/floor/room migration (#860)", () => {
  // Tracer: the whole feature in one row chain. A Sketch on a Job, a Floor with
  // a default ceiling height, and a rectangular Room whose derived measurements
  // are cached — all of it must survive a write and a join-read.
  it("round-trips Sketch → Floor → Room with cached measurements", async () => {
    const orgId = await seedOrg();
    const jobId = await seedJob(orgId);

    const sketchId = await insertSketch(orgId, jobId);
    const floorId = await insertFloor(orgId, sketchId, "Ground Floor", 8);
    // Room inherits the Floor's 8' default (no override).
    const roomId = await insertRoom(
      orgId,
      floorId,
      "Living Room",
      { width: 3, length: 4, ceilingHeightOverride: null },
      8,
    );

    const { rows } = await client.query(
      `SELECT r.name, r.width, r.length, r.ceiling_height_override,
              r.floor_area, r.ceiling_area, r.perimeter,
              r.gross_wall_area, r.net_wall_area, r.volume,
              f.name AS floor_name, f.default_ceiling_height,
              s.job_id, s.organization_id
         FROM rooms r
         JOIN floors f   ON f.id = r.floor_id
         JOIN sketches s ON s.id = f.sketch_id
        WHERE r.id = $1`,
      [roomId],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];

    // The chain joins end-to-end and stays in the right org / job.
    expect(row.floor_name).toBe("Ground Floor");
    expect(row.job_id).toBe(jobId);
    expect(row.organization_id).toBe(orgId);

    // Dimensions and the inherited-vs-default ceiling height round-trip.
    expect(row.name).toBe("Living Room");
    expect(Number(row.width)).toBe(3);
    expect(Number(row.length)).toBe(4);
    expect(row.ceiling_height_override).toBeNull();
    expect(Number(row.default_ceiling_height)).toBe(8);

    // The cached measurements equal M1's output for the effective 3 × 4 × 8.
    const expected = measureRoom({ width: 3, length: 4, ceilingHeight: 8 });
    expect(Number(row.floor_area)).toBe(expected.floorArea);
    expect(Number(row.ceiling_area)).toBe(expected.ceilingArea);
    expect(Number(row.perimeter)).toBe(expected.perimeter);
    expect(Number(row.gross_wall_area)).toBe(expected.grossWallArea);
    expect(Number(row.net_wall_area)).toBe(expected.netWallArea);
    expect(Number(row.volume)).toBe(expected.volume);
  });

  // The 1:1 Sketch ↔ Job rule (CONTEXT.md "Sketch": belongs to exactly one Job).
  // A Job is a single measurement surface, so a second Sketch for the same job_id
  // must be rejected at the DB — UNIQUE(job_id), asserted by the 23505
  // unique_violation code so the test can't pass on some unrelated error.
  it("rejects a second Sketch for the same Job (1:1 via UNIQUE(job_id))", async () => {
    const orgId = await seedOrg();
    const jobId = await seedJob(orgId);

    await insertSketch(orgId, jobId); // first Sketch — fine

    await expect(insertSketch(orgId, jobId)).rejects.toMatchObject({
      code: "23505", // unique_violation
    });
  });

  // Org-scoping (the multi-tenant contract). Every table is tenant_isolation'd on
  // organization_id = active_organization_id(). Two orgs each get a full chain;
  // acting as a member of org A, the policies must surface only org A's rows on
  // ALL THREE tables — catching a forgotten ENABLE/policy on any one of them.
  it("isolates Sketch/Floor/Room reads by organization (tenant_isolation USING)", async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    const jobA = await seedJob(orgA);
    const jobB = await seedJob(orgB);

    const sketchA = await insertSketch(orgA, jobA);
    const sketchB = await insertSketch(orgB, jobB);
    const floorA = await insertFloor(orgA, sketchA, "Ground Floor", 8);
    const floorB = await insertFloor(orgB, sketchB, "Ground Floor", 8);
    const roomA = await insertRoom(
      orgA, floorA, "A", { width: 3, length: 4, ceilingHeightOverride: null }, 8,
    );
    const roomB = await insertRoom(
      orgB, floorB, "B", { width: 5, length: 6, ceilingHeightOverride: null }, 8,
    );

    await asOrg(orgA, async () => {
      const sketches = await client.query("SELECT id, organization_id FROM sketches");
      expect(sketches.rows).toHaveLength(1);
      expect(sketches.rows[0].id).toBe(sketchA);
      expect(sketches.rows[0].organization_id).toBe(orgA);

      const floors = await client.query("SELECT id FROM floors");
      expect(floors.rows.map((r) => r.id)).toEqual([floorA]);

      const rooms = await client.query("SELECT id FROM rooms");
      expect(rooms.rows.map((r) => r.id)).toEqual([roomA]);

      // Org B's rows stay invisible even when addressed by primary key.
      const leakedSketch = await client.query("SELECT 1 FROM sketches WHERE id = $1", [sketchB]);
      const leakedFloor = await client.query("SELECT 1 FROM floors WHERE id = $1", [floorB]);
      const leakedRoom = await client.query("SELECT 1 FROM rooms WHERE id = $1", [roomB]);
      expect(leakedSketch.rows).toHaveLength(0);
      expect(leakedFloor.rows).toHaveLength(0);
      expect(leakedRoom.rows).toHaveLength(0);
    });
  });

  // The write half of the contract: a member of org A cannot plant a row tagged
  // org B — the policy's WITH CHECK rejects it (42501). One table proves the
  // clause; all three share the identical policy SQL.
  it("blocks writing a Sketch into another org (tenant_isolation WITH CHECK)", async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    const jobB = await seedJob(orgB);

    await asOrg(orgA, async () => {
      await expect(
        client.query(
          "INSERT INTO sketches (organization_id, job_id) VALUES ($1, $2)",
          [orgB, jobB],
        ),
      ).rejects.toMatchObject({ code: "42501" }); // insufficient_privilege (RLS)
    });
  });

  // #879 — a hand-drawn polygon footprint must survive the trip as jsonb, drive
  // the cached measurements (true polygon area, not the bounding box), and stay
  // org-scoped like every other column on `rooms`.
  it("round-trips a hand-drawn polygon footprint and keeps it org-scoped", async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    const jobA = await seedJob(orgA);
    const jobB = await seedJob(orgB);
    const sketchA = await insertSketch(orgA, jobA);
    const sketchB = await insertSketch(orgB, jobB);
    const floorA = await insertFloor(orgA, sketchA, "Ground Floor", 8);
    const floorB = await insertFloor(orgB, sketchB, "Ground Floor", 8);

    // An L-shaped Room (a 4×4 square missing a 2×2 bite) — area 12, not the 16
    // its 4×4 bounding box would give. The rectangle model could not express it.
    const L_SHAPE: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 0, y: 4 },
    ];
    const roomA = await insertRoomFootprint(orgA, floorA, "L Room", L_SHAPE, null, 8);
    // A different shape in the other org, to prove the footprint doesn't leak.
    await insertRoomFootprint(orgB, floorB, "Other", rectangleFootprint(5, 6), null, 8);

    const { rows } = await client.query(
      "SELECT footprint, width, length, floor_area, perimeter, volume FROM rooms WHERE id = $1",
      [roomA],
    );
    // The footprint jsonb comes back as the same ordered points.
    expect(rows[0].footprint).toEqual(L_SHAPE);
    // The cache is the true polygon measurement; width/length are the envelope.
    const expected = measureFootprint({ footprint: L_SHAPE, ceilingHeight: 8 });
    expect(Number(rows[0].width)).toBe(4);
    expect(Number(rows[0].length)).toBe(4);
    expect(Number(rows[0].floor_area)).toBe(expected.floorArea); // 12, not 16
    expect(Number(rows[0].perimeter)).toBe(expected.perimeter); // 16
    expect(Number(rows[0].volume)).toBe(expected.volume); // 96

    // Acting as org A, exactly org A's footprint is visible; org B's is filtered.
    await asOrg(orgA, async () => {
      const visible = await client.query("SELECT footprint FROM rooms");
      expect(visible.rows).toHaveLength(1);
      expect(visible.rows[0].footprint).toEqual(L_SHAPE);
    });
  });

  // #879 — the migration backfills pre-existing rectangle Rooms so none is left
  // shapeless. Insert a Room exactly as build88 stored it (width/length set,
  // footprint still the empty default), then re-run the LIVE build89 migration
  // and prove its footprint is reconstructed from width/length.
  it("backfills an existing rectangle Room's footprint from its width/length", async () => {
    const orgId = await seedOrg();
    const jobId = await seedJob(orgId);
    const sketchId = await insertSketch(orgId, jobId);
    const floorId = await insertFloor(orgId, sketchId, "Ground Floor", 8);

    const m = measureRoom({ width: 3, length: 4, ceilingHeight: 8 });
    const { rows: ins } = await client.query<{ id: string }>(
      `INSERT INTO rooms (
         organization_id, floor_id, name, width, length,
         floor_area, ceiling_area, perimeter, gross_wall_area, net_wall_area, volume
       ) VALUES ($1,$2,'Legacy',3,4,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [orgId, floorId, m.floorArea, m.ceilingArea, m.perimeter, m.grossWallArea, m.netWallArea, m.volume],
    );
    const roomId = ins[0].id;

    // Precondition: this row genuinely has the empty default footprint.
    const before = await client.query("SELECT footprint FROM rooms WHERE id = $1", [roomId]);
    expect(before.rows[0].footprint).toEqual([]);

    // Re-running the migration is a no-op for the column and backfills the shape.
    await client.query(MIGRATION_89_SQL);

    const after = await client.query("SELECT footprint FROM rooms WHERE id = $1", [roomId]);
    expect(after.rows[0].footprint).toEqual(rectangleFootprint(3, 4));
  });

  // The migration ships a documented `-- ROLLBACK` block; prove it isn't lying.
  // Run the LIVE down-migration inside a transaction we roll back, so the drop is
  // real (all three tables gone) but the shared cluster is restored for any other
  // test — DDL is transactional in Postgres.
  it("ships a ROLLBACK that drops all three tables", async () => {
    const down = rollbackSql();
    expect(down).toMatch(/DROP TABLE IF EXISTS rooms/i);
    expect(down).toMatch(/DROP TABLE IF EXISTS floors/i);
    expect(down).toMatch(/DROP TABLE IF EXISTS sketches/i);

    await client.query("BEGIN");
    try {
      await client.query(down);
      const { rows } = await client.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN ('sketches','floors','rooms')`,
      );
      expect(rows).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
