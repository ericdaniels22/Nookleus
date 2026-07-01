// Integration coverage for the Room-objects persistence layer —
// migration-build92-room-objects.sql (#867, S7). This is M5 for the object
// inventory whose pure engine lives in src/lib/sketch/object-inventory.ts (M1).
//
// Harness. Same throwaway embedded-postgres approach as sketch-floor-room.pg.test
// (the blessed Docker/Supabase harness is unavailable here): boot a bare cluster,
// load the focused shim schema + the LIVE Sketch migrations verbatim (build88 for
// sketches/floors/rooms, then 89/91 that room_objects' FK target depends on), then
// build92 under test — no copy-paste drift. Run with `npm run test:pg`.
//
// What's pinned here:
//   - a Room object round-trips (category + placement) and joins back to its
//     Room → Floor → Sketch, staying in its org;
//   - deleting a Room cascades its objects away (room_id FK ON DELETE CASCADE);
//   - the count-only vocabulary is enforced at the DB (category CHECK);
//   - the org-isolation contract (tenant_isolation RLS, both USING and WITH CHECK).

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
  join(process.cwd(), "tests", "integration", "sketch-floor-room-schema.sql"),
  "utf8",
);
// The Sketch spine room_objects hangs off. Loaded verbatim, in order: build88
// creates rooms; 89/91 evolve it; 92 (under test) adds room_objects.
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
const MIGRATION_92_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-build92-room-objects.sql"),
  "utf8",
);

/**
 * The DROP statements from migration-build92's `-- ROLLBACK` block, uncommented —
 * so the rollback test runs the LIVE down-migration, not a hand-copied duplicate.
 */
function rollbackSql(): string {
  const lines = MIGRATION_92_SQL.split("\n");
  const start = lines.findIndex((l) => /--\s*ROLLBACK/.test(l));
  if (start === -1) throw new Error("migration-build92 has no ROLLBACK block");
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

const TEST_DB = "room_objects_test";

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
  await client.query(MIGRATION_88_SQL);
  await client.query(MIGRATION_89_SQL);
  await client.query(MIGRATION_91_SQL);
  await client.query(MIGRATION_92_SQL);
  // The tables now exist — grant the RLS test caller the privileges it needs to
  // evaluate (and be filtered by) the tenant_isolation policies.
  await client.query(
    "GRANT SELECT, INSERT, UPDATE, DELETE ON public.sketches, public.floors, public.rooms, public.room_objects TO authenticated;",
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

async function insertFloor(orgId: string, sketchId: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO floors (organization_id, sketch_id, name) VALUES ($1, $2, 'Ground Floor') RETURNING id",
    [orgId, sketchId],
  );
  return rows[0].id;
}

/** A bare Room — the measurement columns default to 0; object tests don't need
 *  a footprint, only a Room to hang objects off. */
async function insertRoom(orgId: string, floorId: string, name: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO rooms (organization_id, floor_id, name) VALUES ($1, $2, $3) RETURNING id",
    [orgId, floorId, name],
  );
  return rows[0].id;
}

async function insertObject(
  orgId: string,
  roomId: string,
  category: string,
  position: { x: number; y: number } = { x: 0, y: 0 },
  rotation = 0,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO room_objects (organization_id, room_id, category, position, rotation)
       VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
    [orgId, roomId, category, JSON.stringify(position), rotation],
  );
  return rows[0].id;
}

/** Run `fn` as a member of `orgId` so the tenant_isolation policies fire. */
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

describe("room-objects migration (#867)", () => {
  // Tracer: a placed object survives the trip and joins back up its chain. A
  // fridge in a kitchen, positioned and rotated, must round-trip and stay in org.
  it("round-trips a Room object and joins back to Room → Floor → Sketch", async () => {
    const orgId = await seedOrg();
    const jobId = await seedJob(orgId);
    const sketchId = await insertSketch(orgId, jobId);
    const floorId = await insertFloor(orgId, sketchId);
    const roomId = await insertRoom(orgId, floorId, "Kitchen");

    const objectId = await insertObject(
      orgId, roomId, "refrigerator", { x: 2.5, y: 4 }, 90,
    );

    const { rows } = await client.query(
      `SELECT o.category, o.position, o.rotation, o.sort_order, o.organization_id,
              r.name AS room_name, f.sketch_id, s.job_id
         FROM room_objects o
         JOIN rooms r    ON r.id = o.room_id
         JOIN floors f   ON f.id = r.floor_id
         JOIN sketches s ON s.id = f.sketch_id
        WHERE o.id = $1`,
      [objectId],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];

    expect(row.category).toBe("refrigerator");
    expect(row.position).toEqual({ x: 2.5, y: 4 });
    expect(Number(row.rotation)).toBe(90);
    expect(row.sort_order).toBe(0);
    expect(row.room_name).toBe("Kitchen");
    expect(row.sketch_id).toBe(sketchId);
    expect(row.job_id).toBe(jobId);
    expect(row.organization_id).toBe(orgId);
  });

  // Placement is optional — an object created without a position defaults to the
  // Room's own origin, never null (NOT NULL DEFAULT), so a capture path that only
  // knows "there's a fridge here somewhere" still writes a valid row.
  it("defaults position to (0,0) and rotation to 0 when unset", async () => {
    const orgId = await seedOrg();
    const jobId = await seedJob(orgId);
    const floorId = await insertFloor(orgId, await insertSketch(orgId, jobId));
    const roomId = await insertRoom(orgId, floorId, "Bath");

    const { rows: ins } = await client.query<{ id: string }>(
      "INSERT INTO room_objects (organization_id, room_id, category) VALUES ($1,$2,'toilet') RETURNING id",
      [orgId, roomId],
    );
    const { rows } = await client.query(
      "SELECT position, rotation FROM room_objects WHERE id = $1",
      [ins[0].id],
    );
    expect(rows[0].position).toEqual({ x: 0, y: 0 });
    expect(Number(rows[0].rotation)).toBe(0);
  });

  // Objects belong to their Room: deleting the Room cascades its whole inventory
  // away, so no orphaned object rows survive a Room removal (room_id FK CASCADE).
  it("cascades objects away when their Room is deleted", async () => {
    const orgId = await seedOrg();
    const jobId = await seedJob(orgId);
    const floorId = await insertFloor(orgId, await insertSketch(orgId, jobId));
    const roomId = await insertRoom(orgId, floorId, "Kitchen");

    await insertObject(orgId, roomId, "cabinets");
    await insertObject(orgId, roomId, "sink");
    expect(
      (await client.query("SELECT id FROM room_objects WHERE room_id = $1", [roomId])).rows,
    ).toHaveLength(2);

    await client.query("DELETE FROM rooms WHERE id = $1", [roomId]);

    const { rows } = await client.query(
      "SELECT id FROM room_objects WHERE room_id = $1",
      [roomId],
    );
    expect(rows).toHaveLength(0);
  });

  // Count-only, KNOWN categories: the DB itself rejects a category outside the
  // vocabulary (the CHECK), so a typo or a stray free-text label can never become
  // an object the inventory would miscount. 23514 = check_violation.
  it("rejects an unknown object category at the DB (category CHECK)", async () => {
    const orgId = await seedOrg();
    const jobId = await seedJob(orgId);
    const floorId = await insertFloor(orgId, await insertSketch(orgId, jobId));
    const roomId = await insertRoom(orgId, floorId, "Kitchen");

    await expect(insertObject(orgId, roomId, "microwave")).rejects.toMatchObject({
      code: "23514",
    });
  });

  // Org-scoping (read): objects are tenant_isolation'd on organization_id. Acting
  // as org A, only org A's objects are visible — org B's stay hidden even by PK.
  it("isolates object reads by organization (tenant_isolation USING)", async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    const floorA = await insertFloor(orgA, await insertSketch(orgA, await seedJob(orgA)));
    const floorB = await insertFloor(orgB, await insertSketch(orgB, await seedJob(orgB)));
    const roomA = await insertRoom(orgA, floorA, "A");
    const roomB = await insertRoom(orgB, floorB, "B");
    const objectA = await insertObject(orgA, roomA, "stove");
    const objectB = await insertObject(orgB, roomB, "oven");

    await asOrg(orgA, async () => {
      const visible = await client.query("SELECT id FROM room_objects");
      expect(visible.rows.map((r) => r.id)).toEqual([objectA]);

      const leaked = await client.query("SELECT 1 FROM room_objects WHERE id = $1", [objectB]);
      expect(leaked.rows).toHaveLength(0);
    });
  });

  // Org-scoping (write): a member of org A cannot plant an object tagged org B —
  // the policy's WITH CHECK rejects it. 42501 = insufficient_privilege (RLS).
  it("blocks writing an object into another org (tenant_isolation WITH CHECK)", async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    const floorB = await insertFloor(orgB, await insertSketch(orgB, await seedJob(orgB)));
    const roomB = await insertRoom(orgB, floorB, "B");

    await asOrg(orgA, async () => {
      await expect(
        client.query(
          "INSERT INTO room_objects (organization_id, room_id, category) VALUES ($1,$2,'sink')",
          [orgB, roomB],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  // The migration ships a documented `-- ROLLBACK`; prove it isn't lying. Run the
  // LIVE down-migration in a rolled-back transaction so the drop is real but the
  // shared cluster is restored for any other test (DDL is transactional in PG).
  it("ships a ROLLBACK that drops room_objects", async () => {
    const down = rollbackSql();
    expect(down).toMatch(/DROP TABLE IF EXISTS room_objects/i);

    await client.query("BEGIN");
    try {
      await client.query(down);
      const { rows } = await client.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'room_objects'`,
      );
      expect(rows).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
