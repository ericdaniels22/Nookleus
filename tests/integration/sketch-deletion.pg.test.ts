// Integration coverage for the Sketch deletion lifecycle (#869, S9). This is the
// acceptance test for "delete a Job's Sketch": it drives a real database and pins
// the two behaviors the app relies on when the full-screen editor's "start over"
// runs (the delete itself is issued by src/lib/sketch/delete-sketch.ts, unit-
// tested in that file; here we prove what the DB does when it fires).
//
// Harness. The repo's blessed integration harness boots Supabase via
// `supabase start` (Docker + virtualization), unavailable here. The behavior
// under test is DDL-level machinery — ON DELETE CASCADE and the deliberate
// ABSENCE of an FK from sketch_source to the Sketch — so we boot a throwaway
// embedded-postgres cluster, load a focused schema + the LIVE migrations verbatim
// (build88 → build89 → build91 create the sketch chain; build90 adds the line
// item's sketch_source column), and drive it through a raw `pg` client. Nothing
// touches the network or Docker. Run with `npm run test:pg`.
//
// What's pinned here (issue #869 acceptance):
//   - deleting the Sketch cascades its Floors and Rooms, and the stored mesh
//     (the row's mesh_ref) goes with it — the plan is fully removed;
//   - a line item pulled from that Sketch keeps its frozen quantity + snapshot:
//     sketch_source is decoupled jsonb with no FK (ADR 0004), so a deleted source
//     never corrupts a built estimate;
//   - a re-pull on that orphaned line item resolves `source-missing` (the source
//     Room is gone), leaving the frozen quantity untouched (#864 AC #4).

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

import EmbeddedPostgres from "embedded-postgres";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveRoomPull, resolveRoomRepull } from "../../src/lib/sketch/pull-resolver";
import type { RoomSketchSource } from "../../src/lib/sketch/pull-resolver";

const SCHEMA_SQL = readFileSync(
  join(process.cwd(), "tests", "integration", "sketch-deletion-schema.sql"),
  "utf8",
);
const MIGRATION_88_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-build88-sketch-floor-room.sql"),
  "utf8",
);
const MIGRATION_89_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-build89-room-footprint.sql"),
  "utf8",
);
const MIGRATION_91_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-build91-room-origin.sql"),
  "utf8",
);
const MIGRATION_90_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-build90-line-item-sketch-source.sql"),
  "utf8",
);

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

const TEST_DB = "sketch_deletion_test";

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

  // build88's policies GRANT to `authenticated`; create the role Supabase
  // provides but a bare cluster does not so the migration SQL loads verbatim.
  await client.query(
    "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF; END $$;",
  );
  await client.query(SCHEMA_SQL);
  await client.query(MIGRATION_88_SQL);
  await client.query(MIGRATION_89_SQL);
  await client.query(MIGRATION_91_SQL);
  await client.query(MIGRATION_90_SQL);
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

/** Seed a Sketch, optionally carrying a stored-mesh reference (build88's mesh_ref
 *  placeholder). A hand-drawn Sketch leaves it NULL; a scanned one points at the
 *  stored mesh — deletion must take that reference with the row. */
async function insertSketch(
  orgId: string,
  jobId: string,
  meshRef: string | null = null,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO sketches (organization_id, job_id, mesh_ref) VALUES ($1, $2, $3) RETURNING id",
    [orgId, jobId, meshRef],
  );
  return rows[0].id;
}

async function insertFloor(orgId: string, sketchId: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO floors (organization_id, sketch_id, name) VALUES ($1, $2, 'Ground Floor') RETURNING id",
    [orgId, sketchId],
  );
  return rows[0].id;
}

/** Seed a Room with a given cached net wall area — the only measurement the pull
 *  freeze reads. The other cached columns default to 0 (build88). */
async function insertRoom(
  orgId: string,
  floorId: string,
  netWallArea: number,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO rooms (organization_id, floor_id, name, net_wall_area) VALUES ($1, $2, 'Living Room', $3) RETURNING id",
    [orgId, floorId, netWallArea],
  );
  return rows[0].id;
}

/** Seed an estimate + one section + one hand-typed line item; return the item id. */
async function seedLineItem(orgId: string, unitPrice: number): Promise<string> {
  const { rows: est } = await client.query<{ id: string }>(
    "INSERT INTO estimates (organization_id, job_id) VALUES ($1, $2) RETURNING id",
    [orgId, randomUUID()],
  );
  const { rows: sec } = await client.query<{ id: string }>(
    "INSERT INTO estimate_sections (organization_id, estimate_id, title) VALUES ($1,$2,'Work') RETURNING id",
    [orgId, est[0].id],
  );
  const { rows: item } = await client.query<{ id: string }>(
    `INSERT INTO estimate_line_items
       (organization_id, estimate_id, section_id, description, quantity, unit_price, total)
       VALUES ($1,$2,$3,'Paint walls',1,$4,$4) RETURNING id`,
    [orgId, est[0].id, sec[0].id, unitPrice],
  );
  return item[0].id;
}

/**
 * Apply a Room net-wall-area pull the way the API route does: resolve the frozen
 * value + source via the pure M3 resolver, then persist quantity/total/
 * sketch_source in one UPDATE. Returns the frozen source for later re-pull.
 */
async function pullNetWallArea(
  itemId: string,
  sketchId: string,
  floorId: string,
  roomId: string,
  netWallArea: number,
  unitPrice: number,
): Promise<void> {
  const pull = resolveRoomPull({
    measurements: {
      floorArea: 0,
      ceilingArea: 0,
      perimeter: 0,
      grossWallArea: 0,
      netWallArea,
      volume: 0,
    },
    kind: "wall_area_net",
    sketchId,
    floorId,
    roomId,
    roomName: "Living Room",
    pulledAt: "2026-06-30T12:00:00.000Z",
  });
  await client.query(
    `UPDATE estimate_line_items
        SET quantity = $2, total = $3, sketch_source = $4::jsonb
      WHERE id = $1`,
    [itemId, pull.value, pull.value * unitPrice, JSON.stringify(pull.source)],
  );
}

/**
 * Mirror the re-pull route's readSourceRoomMeasurements: walk job → sketch →
 * floor → room and read the live net wall area, or return null when any link is
 * gone. After the Sketch is deleted the whole chain is missing, so this returns
 * null — the "deleted source" signal resolveRoomRepull branches on.
 */
async function readSourceNetWallArea(roomId: string): Promise<number | null> {
  const { rows } = await client.query<{ net_wall_area: string }>(
    "SELECT net_wall_area FROM rooms WHERE id = $1",
    [roomId],
  );
  return rows.length ? Number(rows[0].net_wall_area) : null;
}

describe("sketch deletion lifecycle (#869)", () => {
  // Tracer: deleting the Sketch cascades the whole plan. A Sketch with a Floor
  // and two Rooms; a single DELETE on `sketches` (what deleteSketch issues) must
  // leave no Floor and no Room behind — build88's ON DELETE CASCADE.
  it("cascades Floors and Rooms when the Sketch is deleted", async () => {
    const orgId = await seedOrg();
    const jobId = await seedJob(orgId);
    const sketchId = await insertSketch(orgId, jobId);
    const floorId = await insertFloor(orgId, sketchId);
    await insertRoom(orgId, floorId, 100);
    await insertRoom(orgId, floorId, 200);

    await client.query("DELETE FROM sketches WHERE id = $1", [sketchId]);

    const sketches = await client.query("SELECT 1 FROM sketches WHERE id = $1", [sketchId]);
    const floors = await client.query("SELECT 1 FROM floors WHERE sketch_id = $1", [sketchId]);
    const rooms = await client.query("SELECT 1 FROM rooms WHERE floor_id = $1", [floorId]);
    expect(sketches.rows).toHaveLength(0);
    expect(floors.rows).toHaveLength(0);
    expect(rooms.rows).toHaveLength(0);
  });

  // The stored mesh is cleaned up / dereferenced (#869 AC #1). A scanned Sketch
  // carries its mesh on the row's `mesh_ref`; deleting the Sketch removes the row
  // and the reference with it — nothing is left pointing at the stored mesh.
  it("removes the stored-mesh reference when the Sketch is deleted", async () => {
    const orgId = await seedOrg();
    const jobId = await seedJob(orgId);
    const meshRef = "mesh://" + randomUUID();
    const sketchId = await insertSketch(orgId, jobId, meshRef);

    // Precondition: the row genuinely carries the mesh reference before deletion.
    const before = await client.query(
      "SELECT mesh_ref FROM sketches WHERE id = $1",
      [sketchId],
    );
    expect(before.rows[0].mesh_ref).toBe(meshRef);

    await client.query("DELETE FROM sketches WHERE id = $1", [sketchId]);

    const after = await client.query(
      "SELECT mesh_ref FROM sketches WHERE mesh_ref = $1",
      [meshRef],
    );
    expect(after.rows).toHaveLength(0);
  });

  // The freeze survives deletion (#869 AC #2, ADR 0004). A line item pulled from a
  // Room in the Sketch keeps its frozen quantity, total, and sketch_source snapshot
  // AFTER the Sketch (and its Rooms) are deleted — there is deliberately no FK from
  // sketch_source back to the Sketch, so a deleted source never corrupts a built
  // estimate.
  it("keeps a line item's frozen quantity + sketch_source after the Sketch is deleted", async () => {
    const orgId = await seedOrg();
    const jobId = await seedJob(orgId);
    const sketchId = await insertSketch(orgId, jobId);
    const floorId = await insertFloor(orgId, sketchId);
    const roomId = await insertRoom(orgId, floorId, 100);

    const itemId = await seedLineItem(orgId, 10);
    await pullNetWallArea(itemId, sketchId, floorId, roomId, 100, 10);

    await client.query("DELETE FROM sketches WHERE id = $1", [sketchId]);

    // The source Room is gone (it cascaded)…
    expect(await readSourceNetWallArea(roomId)).toBeNull();
    // …but the frozen line item is untouched: quantity, total, and the breadcrumb.
    const { rows } = await client.query(
      "SELECT quantity, total, sketch_source FROM estimate_line_items WHERE id = $1",
      [itemId],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].quantity)).toBe(100);
    expect(Number(rows[0].total)).toBe(1000);
    expect(rows[0].sketch_source.value).toBe(100);
    expect(rows[0].sketch_source.room_id).toBe(roomId);
    expect(rows[0].sketch_source.kind).toBe("wall_area_net");
  });

  // Re-pull on the orphaned line item fails cleanly (#869 AC #3). After the Sketch
  // is deleted the walk to the source Room returns null, so resolveRoomRepull
  // yields `source-missing` and carries no refreshed source — the frozen quantity
  // must be left exactly as it was (#864 AC #4).
  it("re-pull resolves source-missing and leaves the frozen quantity unchanged", async () => {
    const orgId = await seedOrg();
    const jobId = await seedJob(orgId);
    const sketchId = await insertSketch(orgId, jobId);
    const floorId = await insertFloor(orgId, sketchId);
    const roomId = await insertRoom(orgId, floorId, 100);

    const itemId = await seedLineItem(orgId, 10);
    await pullNetWallArea(itemId, sketchId, floorId, roomId, 100, 10);

    await client.query("DELETE FROM sketches WHERE id = $1", [sketchId]);

    // Read back the frozen breadcrumb, then re-pull against the (now-missing) source.
    const { rows: frozen } = await client.query<{ sketch_source: RoomSketchSource }>(
      "SELECT sketch_source FROM estimate_line_items WHERE id = $1",
      [itemId],
    );
    const measurements = await readSourceNetWallArea(roomId); // null — Room is gone
    const repull = resolveRoomRepull({
      source: frozen[0].sketch_source,
      measurements:
        measurements === null
          ? null
          : {
              floorArea: 0,
              ceilingArea: 0,
              perimeter: 0,
              grossWallArea: 0,
              netWallArea: measurements,
              volume: 0,
            },
      currentQuantity: 100,
      pulledAt: "2026-06-30T18:00:00.000Z",
    });

    // The resolver reports the source is gone and produces no refreshed breadcrumb,
    // so the route writes nothing — the frozen quantity stands.
    expect(repull.status).toBe("source-missing");
    const { rows } = await client.query(
      "SELECT quantity, total, sketch_source FROM estimate_line_items WHERE id = $1",
      [itemId],
    );
    expect(Number(rows[0].quantity)).toBe(100);
    expect(Number(rows[0].total)).toBe(1000);
    expect(rows[0].sketch_source.value).toBe(100);
  });
});
