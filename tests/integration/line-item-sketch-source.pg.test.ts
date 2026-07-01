// Integration coverage for the line-item Sketch-source column —
// migration-build90-line-item-sketch-source.sql (#861, S2 "money slice"). This
// is M5: the acceptance test that sketch_source actually persists and freezes.
//
// Harness. The repo's blessed integration harness boots Supabase via
// `supabase start` (Docker + virtualization), unavailable here. The thing under
// test is plain DDL — a nullable jsonb column and its snapshot semantics — so we
// boot a throwaway embedded-postgres cluster, load a focused schema WITHOUT the
// column, apply the LIVE build90 migration verbatim (no copy-paste drift), and
// drive it through a raw `pg` client. Nothing touches the network or Docker.
// Run with `npm run test:pg`.
//
// What's pinned here:
//   - the pull round-trip: the migration's sketch_source persists the SketchSource
//     jsonb snapshot exactly, alongside the frozen quantity/total;
//   - the FREEZE (ADR 0004, acceptance #4): editing the source Room after the
//     pull never moves the line item — the snapshot is decoupled, no FK;
//   - the additive/nullable contract (acceptance #2): a hand-typed line item's
//     sketch_source is NULL and stays NULL;
//   - the documented ROLLBACK drops the column.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

import EmbeddedPostgres from "embedded-postgres";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveRoomPull } from "../../src/lib/sketch/pull-resolver";

const SCHEMA_SQL = readFileSync(
  join(process.cwd(), "tests", "integration", "line-item-sketch-source-schema.sql"),
  "utf8",
);
const MIGRATION_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-build90-line-item-sketch-source.sql"),
  "utf8",
);

/**
 * The uncommented ALTER statements from build90's `-- ROLLBACK` block. Lets the
 * rollback test run the LIVE down-migration verbatim instead of a hand-copied
 * duplicate that could drift from the comment.
 */
function rollbackSql(): string {
  const lines = MIGRATION_SQL.split("\n");
  const start = lines.findIndex((l) => /--\s*ROLLBACK/.test(l));
  if (start === -1) throw new Error("migration-build90 has no ROLLBACK block");
  return lines
    .slice(start + 1)
    .map((l) => l.replace(/^--\s?/, "").trim())
    .filter((l) => /^ALTER\b/i.test(l))
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

const TEST_DB = "line_item_sketch_source_test";

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
      /* best-effort temp-dir cleanup; Windows may still hold a handle */
    }
  }
});

/** Seed an estimate + one section + one hand-typed line item; return their ids. */
async function seedLineItem(unitPrice: number): Promise<{
  estimateId: string;
  itemId: string;
}> {
  const orgId = randomUUID();
  const { rows: est } = await client.query<{ id: string }>(
    "INSERT INTO estimates (organization_id, job_id) VALUES ($1, $2) RETURNING id",
    [orgId, randomUUID()],
  );
  const estimateId = est[0].id;
  const { rows: sec } = await client.query<{ id: string }>(
    "INSERT INTO estimate_sections (organization_id, estimate_id, title) VALUES ($1,$2,'Work') RETURNING id",
    [orgId, estimateId],
  );
  const { rows: item } = await client.query<{ id: string }>(
    `INSERT INTO estimate_line_items
       (organization_id, estimate_id, section_id, description, quantity, unit_price, total)
       VALUES ($1,$2,$3,'Paint walls',1,$4,$4) RETURNING id`,
    [orgId, estimateId, sec[0].id, unitPrice],
  );
  return { estimateId, itemId: item[0].id };
}

/**
 * Apply a pull the way the API route does: resolve the frozen value + source via
 * the pure M3 resolver, then persist quantity/total/sketch_source in one UPDATE.
 */
async function pullNetWallArea(
  itemId: string,
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
    sketchId: randomUUID(),
    floorId: randomUUID(),
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

describe("line-item sketch_source migration (#861)", () => {
  // Tracer: a pull persists the frozen number in `quantity` and the SketchSource
  // breadcrumb in `sketch_source`, and both survive a write-then-read round-trip
  // through the column the LIVE build90 migration added.
  it("persists the sketch_source snapshot jsonb alongside the frozen quantity", async () => {
    const { itemId } = await seedLineItem(10);
    const roomId = randomUUID();
    await pullNetWallArea(itemId, roomId, 100, 10);

    const { rows } = await client.query(
      "SELECT quantity, total, sketch_source FROM estimate_line_items WHERE id = $1",
      [itemId],
    );
    expect(rows).toHaveLength(1);
    // The frozen number is the net wall area; the total is quantity × unit_price.
    expect(Number(rows[0].quantity)).toBe(100);
    expect(Number(rows[0].total)).toBe(1000);
    // jsonb round-trips as the exact SketchSource object the resolver produced.
    expect(rows[0].sketch_source).toEqual({
      scope: "room",
      sketch_id: expect.any(String),
      floor_id: expect.any(String),
      room_id: roomId,
      room_name: "Living Room",
      kind: "wall_area_net",
      value: 100,
      pulled_at: "2026-06-30T12:00:00.000Z",
    });
  });

  // The freeze (ADR 0004, acceptance #4). Once pulled, the line item's quantity
  // is a snapshot: re-scanning the Sketch — modelled here as an UPDATE to the
  // source Room's cached net_wall_area — must leave both the frozen quantity and
  // the sketch_source.value untouched. There is deliberately no FK or trigger
  // tying the two, so the source can even change out from under a still-correct
  // line item.
  it("freezes the pulled quantity — editing the Room afterward does not move it", async () => {
    const { itemId } = await seedLineItem(10);
    const { rows: roomRows } = await client.query<{ id: string }>(
      "INSERT INTO rooms (net_wall_area) VALUES (100) RETURNING id",
    );
    const roomId = roomRows[0].id;

    await pullNetWallArea(itemId, roomId, 100, 10);

    // The Room grows after the pull (a re-scan). The frozen line item must ignore it.
    await client.query("UPDATE rooms SET net_wall_area = 999 WHERE id = $1", [roomId]);

    const { rows } = await client.query(
      "SELECT quantity, total, sketch_source FROM estimate_line_items WHERE id = $1",
      [itemId],
    );
    expect(Number(rows[0].quantity)).toBe(100);
    expect(Number(rows[0].total)).toBe(1000);
    expect(rows[0].sketch_source.value).toBe(100);
    // The Room itself did change — proving the freeze is real, not a no-op update.
    const { rows: room } = await client.query(
      "SELECT net_wall_area FROM rooms WHERE id = $1",
      [roomId],
    );
    expect(Number(room[0].net_wall_area)).toBe(999);
  });

  // The additive, nullable contract (acceptance #2). A hand-typed line item — one
  // whose quantity never came from a Sketch — has a NULL sketch_source, and
  // ordinary edits to its other columns leave it NULL. The column is metadata a
  // non-Sketch row simply doesn't carry.
  it("leaves sketch_source NULL for a hand-typed line item", async () => {
    const { itemId } = await seedLineItem(10);

    const { rows: fresh } = await client.query(
      "SELECT sketch_source FROM estimate_line_items WHERE id = $1",
      [itemId],
    );
    expect(fresh[0].sketch_source).toBeNull();

    // A normal edit that doesn't touch sketch_source must not conjure one.
    await client.query(
      "UPDATE estimate_line_items SET quantity = 5, total = 50 WHERE id = $1",
      [itemId],
    );
    const { rows: after } = await client.query(
      "SELECT quantity, sketch_source FROM estimate_line_items WHERE id = $1",
      [itemId],
    );
    expect(Number(after[0].quantity)).toBe(5);
    expect(after[0].sketch_source).toBeNull();
  });

  // The migration ships a documented `-- ROLLBACK` block; prove it isn't lying.
  // Run the LIVE down-migration inside a transaction we roll back, so the drop is
  // real (the column gone) but the shared cluster is restored for any other test
  // — DDL is transactional in Postgres.
  it("ships a ROLLBACK that drops the sketch_source column", async () => {
    const down = rollbackSql();
    expect(down).toMatch(/DROP COLUMN IF EXISTS sketch_source/i);

    await client.query("BEGIN");
    try {
      await client.query(down);
      const { rows } = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'estimate_line_items'
            AND column_name = 'sketch_source'`,
      );
      expect(rows).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
