// Integration coverage for the conversation owner snapshot —
// migration-316-conversation-owner-snapshot.sql (#317, PRD #304, ADR 0005).
//
// Why this exists. Personal-number content visibility (phone_conversations /
// phone_messages / phone_calls SELECT RLS) used to join LIVE to
// phone_numbers.user_id. Offboarding releases a Personal line but KEEPS the
// row, and re-claiming REVIVES that row with a NEW owner (#317 slice 7b) — so
// a live join would expose the departed member's prior conversations/messages/
// calls to the new owner, breaking ADR 0005's content-privacy invariant.
//
// The fix snapshots the owner onto phone_conversations at creation via a
// BEFORE INSERT trigger and points the RLS Personal-owner branch at that
// snapshot. The snapshot is IMMUTABLE: reassigning the number later does not
// move existing conversations to the new owner. That immutability is the whole
// cure, and it is observable WITHOUT RLS — so the embedded-postgres harness
// (superuser, RLS bypassed) pins it directly here. The visibility matrix that
// consumes the snapshot is pinned by supabase/migration-316-smoke-test.sql.
//
// Harness mirrors phone-recordings.pg.test.ts: a throwaway embedded-postgres
// cluster, a focused schema + the LIVE migration loaded verbatim, driven via a
// raw `pg` client. No Docker, no network. Run with `npm run test:pg`.

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
  join(
    process.cwd(),
    "tests",
    "integration",
    "conversation-owner-snapshot-schema.sql",
  ),
  "utf8",
);
const MIGRATION_SQL = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migration-316-conversation-owner-snapshot.sql",
  ),
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

const TEST_DB = "conversation_owner_snapshot_test";

beforeAll(async () => {
  // Data dir under the OS temp root, NOT the OneDrive-synced project tree
  // (OneDrive interferes with initdb's file locking).
  dataDir = mkdtempSync(join(tmpdir(), "nookleus-pg-"));
  pgServer = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: await freePort(),
    user: "postgres",
    password: "postgres",
    persistent: false,
    // --locale=C keeps UTF8 valid on Windows (initdb would otherwise inherit
    // WIN1252 and choke on the UTF-8 box-drawing in the migration comments).
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });

  await pgServer.initialise();
  await pgServer.start();
  await pgServer.createDatabase(TEST_DB);

  client = pgServer.getPgClient(TEST_DB);
  await client.connect();

  // The migration's policies are `for select to authenticated`; create the
  // role Supabase provides but a bare cluster doesn't, so the SQL loads verbatim.
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
      /* best-effort temp-dir cleanup; Windows may still hold a handle */
    }
  }
});

/** The migration's own commented `-- ROLLBACK ---` block, un-commented and
 *  ready to execute — pins that the documented revert is valid and complete. */
function rollbackSql(): string {
  const marker = "-- ROLLBACK ---";
  const block = MIGRATION_SQL.slice(
    MIGRATION_SQL.indexOf(marker) + marker.length,
  );
  return block
    .split("\n")
    .map((l) => l.replace(/^--\s?/, "").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

async function seedOrg(): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Org', 'org-' || $1) RETURNING id",
    [randomUUID()],
  );
  return rows[0].id;
}

/** Insert a phone_numbers row owned by `ownerId` (null = Shared). */
async function seedNumber(
  orgId: string,
  ownerId: string | null,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO phone_numbers (organization_id, user_id) VALUES ($1, $2) RETURNING id",
    [orgId, ownerId],
  );
  return rows[0].id;
}

async function ownerOf(conversationId: string): Promise<string | null> {
  const { rows } = await client.query<{ owner_user_id: string | null }>(
    "SELECT owner_user_id FROM phone_conversations WHERE id = $1",
    [conversationId],
  );
  return rows[0].owner_user_id;
}

describe("conversation owner snapshot migration (#316)", () => {
  // Tracer: the snapshot is taken from the number's owner at insert time.
  it("snapshots owner_user_id from the number's owner on insert", async () => {
    const orgId = await seedOrg();
    const bob = randomUUID();
    const numberId = await seedNumber(orgId, bob);

    const { rows } = await client.query<{ id: string }>(
      "INSERT INTO phone_conversations (organization_id, phone_number_id, outside_e164) VALUES ($1, $2, '+15125550001') RETURNING id",
      [orgId, numberId],
    );
    expect(await ownerOf(rows[0].id)).toBe(bob);
  });

  // The anti-leak invariant. Reviving a released number reassigns
  // phone_numbers.user_id to the new claimant; the departed owner's existing
  // conversation must KEEP its original owner snapshot, so the new owner can
  // never see it. (Under live-join RLS this row would have followed the number
  // to the new owner — the exact leak this migration closes.)
  it("keeps the owner snapshot when the number is later reassigned (revive)", async () => {
    const orgId = await seedOrg();
    const bob = randomUUID();
    const carol = randomUUID();
    const numberId = await seedNumber(orgId, bob);

    const { rows } = await client.query<{ id: string }>(
      "INSERT INTO phone_conversations (organization_id, phone_number_id, outside_e164) VALUES ($1, $2, '+15125550002') RETURNING id",
      [orgId, numberId],
    );
    const conversationId = rows[0].id;

    // Offboarding + re-claim: the number row is revived for a new owner.
    await client.query("UPDATE phone_numbers SET user_id = $1 WHERE id = $2", [
      carol,
      numberId,
    ]);

    // Bob's conversation stays Bob's — it did NOT follow the number to Carol.
    expect(await ownerOf(conversationId)).toBe(bob);
  });

  // A Shared number (user_id null) snapshots null — the "team-visible" sentinel
  // the rewritten policies read.
  it("snapshots null for a Shared number", async () => {
    const orgId = await seedOrg();
    const numberId = await seedNumber(orgId, null);

    const { rows } = await client.query<{ id: string }>(
      "INSERT INTO phone_conversations (organization_id, phone_number_id, outside_e164) VALUES ($1, $2, '+15125550003') RETURNING id",
      [orgId, numberId],
    );
    expect(await ownerOf(rows[0].id)).toBeNull();
  });

  // The one-time backfill: conversations that predate the column must inherit
  // their number's current owner. Simulate a legacy row by disabling the
  // trigger for the insert, then run the migration's backfill statement.
  it("backfills owner_user_id on pre-existing conversations from the number's owner", async () => {
    const orgId = await seedOrg();
    const dave = randomUUID();
    const numberId = await seedNumber(orgId, dave);

    await client.query(
      "ALTER TABLE phone_conversations DISABLE TRIGGER trg_phone_conversations_set_owner",
    );
    const { rows } = await client.query<{ id: string }>(
      "INSERT INTO phone_conversations (organization_id, phone_number_id, outside_e164) VALUES ($1, $2, '+15125550004') RETURNING id",
      [orgId, numberId],
    );
    await client.query(
      "ALTER TABLE phone_conversations ENABLE TRIGGER trg_phone_conversations_set_owner",
    );
    const legacyId = rows[0].id;
    expect(await ownerOf(legacyId)).toBeNull(); // legacy: not snapshotted yet

    // Re-run the migration's backfill UPDATE verbatim.
    await client.query(
      `UPDATE public.phone_conversations pc
          SET owner_user_id = pn.user_id
         FROM public.phone_numbers pn
        WHERE pn.id = pc.phone_number_id
          AND pc.owner_user_id IS NULL
          AND pn.user_id IS NOT NULL`,
    );
    expect(await ownerOf(legacyId)).toBe(dave);
  });

  // AC: the migration applies and rolls back cleanly. Run the migration's OWN
  // commented revert block — it must drop the trigger, function, and column and
  // restore the prior policies without error. Re-apply so the cluster is intact
  // for any tests added later (this runs last).
  it("rolls back cleanly via its own -- ROLLBACK -- block", async () => {
    await client.query(rollbackSql());

    const { rows: col } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'phone_conversations' AND column_name = 'owner_user_id'",
    );
    expect(col[0].n).toBe(0);

    const { rows: trg } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'trg_phone_conversations_set_owner'",
    );
    expect(trg[0].n).toBe(0);

    // Restore so the schema is intact if more tests join this file later.
    await client.query(MIGRATION_SQL);
  });
});

// The visibility matrix the snapshot feeds, exercised under real RLS. Unlike
// the structural tests above (superuser, RLS bypassed), these impersonate a
// caller via `SET ROLE authenticated` + GUC-backed auth.uid()/active_org, so
// the migration's rewritten SELECT policies actually run. This is the local
// counterpart to supabase/migration-316-smoke-test.sql.
describe("conversation owner snapshot — RLS visibility (ADR 0005 + revive)", () => {
  // Visible ids on `table` as the impersonated caller, scoped by the org GUC
  // (the policies all filter organization_id = active_organization_id()).
  async function visibleIdsAs(
    uid: string,
    orgId: string,
    table: "phone_conversations" | "phone_messages" | "phone_calls",
  ): Promise<string[]> {
    await client.query("SET ROLE authenticated");
    await client.query("SELECT set_config('test.uid', $1, false)", [uid]);
    await client.query("SELECT set_config('test.org', $1, false)", [orgId]);
    try {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM public.${table} ORDER BY id`,
      );
      return rows.map((r) => r.id);
    } finally {
      await client.query("RESET ROLE");
    }
  }

  it("scopes Personal content to the owner, walls the new owner off after a revive, and keeps job-tagged content team-visible", async () => {
    const orgId = await seedOrg();
    const carol = randomUUID(); // original owner
    const ben = randomUUID(); // teammate / future re-claimant
    const numberId = await seedNumber(orgId, carol);

    // Carol's conversation on her Personal line, with an untagged call, an
    // untagged message, and a Job-tagged message (team-visible).
    const { rows: convRows } = await client.query<{ id: string }>(
      "INSERT INTO phone_conversations (organization_id, phone_number_id, outside_e164) VALUES ($1, $2, '+15551110001') RETURNING id",
      [orgId, numberId],
    );
    const carolConv = convRows[0].id;
    const { rows: jobRows } = await client.query<{ id: string }>(
      "INSERT INTO jobs (organization_id) VALUES ($1) RETURNING id",
      [orgId],
    );
    const jobId = jobRows[0].id;
    const { rows: untaggedMsg } = await client.query<{ id: string }>(
      "INSERT INTO phone_messages (organization_id, conversation_id) VALUES ($1, $2) RETURNING id",
      [orgId, carolConv],
    );
    const { rows: taggedMsg } = await client.query<{ id: string }>(
      "INSERT INTO phone_messages (organization_id, conversation_id, job_tag) VALUES ($1, $2, $3) RETURNING id",
      [orgId, carolConv, jobId],
    );
    await client.query(
      "INSERT INTO phone_calls (organization_id, conversation_id) VALUES ($1, $2)",
      [orgId, carolConv],
    );

    // Pre-revive. Carol (owner) sees her conversation; Ben (teammate) does not.
    expect(await visibleIdsAs(carol, orgId, "phone_conversations")).toContain(
      carolConv,
    );
    expect(await visibleIdsAs(ben, orgId, "phone_conversations")).not.toContain(
      carolConv,
    );

    // Untagged Personal message: owner-only. Job-tagged message: team-visible
    // (the EXISTS-on-conversation subquery must not hide it from a non-owner).
    expect(await visibleIdsAs(carol, orgId, "phone_messages")).toEqual(
      expect.arrayContaining([untaggedMsg[0].id, taggedMsg[0].id]),
    );
    const benMsgs = await visibleIdsAs(ben, orgId, "phone_messages");
    expect(benMsgs).toContain(taggedMsg[0].id); // job-tagged → team-visible
    expect(benMsgs).not.toContain(untaggedMsg[0].id); // untagged → owner-only

    // Carol's untagged call is owner-only.
    expect((await visibleIdsAs(ben, orgId, "phone_calls")).length).toBe(0);

    // --- Offboarding + re-claim: revive the number for Ben. ---
    await client.query("UPDATE phone_numbers SET user_id = $1 WHERE id = $2", [
      ben,
      numberId,
    ]);
    // Ben starts a fresh conversation on the revived line.
    const { rows: benConvRows } = await client.query<{ id: string }>(
      "INSERT INTO phone_conversations (organization_id, phone_number_id, outside_e164) VALUES ($1, $2, '+15552220002') RETURNING id",
      [orgId, numberId],
    );
    const benConv = benConvRows[0].id;

    // Post-revive: Ben sees ONLY his own new conversation, never Carol's prior
    // one — the snapshot wall holds even though he now owns the number. Carol's
    // content stays Carol's.
    const benConvs = await visibleIdsAs(ben, orgId, "phone_conversations");
    expect(benConvs).toContain(benConv);
    expect(benConvs).not.toContain(carolConv);
    expect(benConvs).toEqual([benConv]);

    const carolConvs = await visibleIdsAs(carol, orgId, "phone_conversations");
    expect(carolConvs).toEqual([carolConv]);

    // And Carol's prior untagged message/call remain invisible to the new owner.
    expect(await visibleIdsAs(ben, orgId, "phone_messages")).not.toContain(
      untaggedMsg[0].id,
    );
    expect((await visibleIdsAs(ben, orgId, "phone_calls")).length).toBe(0);
  });

  it("keeps Shared-number content team-visible to any member", async () => {
    const orgId = await seedOrg();
    const someone = randomUUID();
    const numberId = await seedNumber(orgId, null); // Shared

    const { rows } = await client.query<{ id: string }>(
      "INSERT INTO phone_conversations (organization_id, phone_number_id, outside_e164) VALUES ($1, $2, '+15553330003') RETURNING id",
      [orgId, numberId],
    );
    // A member who owns nothing still sees the Shared conversation.
    expect(await visibleIdsAs(someone, orgId, "phone_conversations")).toEqual([
      rows[0].id,
    ]);
  });
});
