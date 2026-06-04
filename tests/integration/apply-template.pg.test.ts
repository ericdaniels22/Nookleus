// Integration coverage for `apply_template_to_estimate` — the PL/pgSQL RPC
// first defined by #351 and then simplified by #353
// (docs/adr/0004-template-line-items-snapshot.md).
//
// As of #353 the RPC reads only the flat snapshot fields: no item_library
// lookup, no `*_override` fallback, and no broken_refs in the return value.
// This suite loads migration-351 then migration-353 (the body swap that drops
// the dual shape) so it exercises the current production function. The legacy
// cases below assert the post-#353 contract — an un-backfilled item that only
// carried overrides / a library pointer now degrades to the NOT-NULL defaults,
// which is exactly why the #352 backfill is a hard prerequisite for #353.
//
// Harness. The repo's blessed integration harness (tests/integration/
// global-setup.ts) boots Supabase via `supabase start`, which needs Docker +
// hardware virtualization — unavailable on this machine. Since the thing under
// test is a database function, we instead boot a throwaway embedded-postgres
// cluster, load a focused schema + the LIVE migration SQL verbatim (no
// copy-paste drift), and drive it through a raw `pg` client at the SQL layer.
// Nothing here touches the network, Docker, or the local PG service. Run with
// `npm run test:pg`.
//
// node-postgres returns `numeric` columns as strings to preserve precision, so
// every numeric assertion coerces with Number().

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

import EmbeddedPostgres from "embedded-postgres";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCHEMA_SQL = readFileSync(join(process.cwd(), "tests", "integration", "apply-template-schema.sql"), "utf8");
const MIGRATION_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-351-template-line-items-snapshot.sql"),
  "utf8",
);
const CLEANUP_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-353-drop-template-dual-shape.sql"),
  "utf8",
);
// #382: the note-aware body swap. Loaded last so apply copies the snapshot note.
const NOTE_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-382b-copy-line-item-note.sql"),
  "utf8",
);

/** Grab a free ephemeral port so the cluster never collides with the local
 *  PostgreSQL 17/18 services already listening on 5432. */
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

const TEST_DB = "apply_template_test";

beforeAll(async () => {
  // Data dir under the OS temp root, NOT under the OneDrive-synced project
  // tree (OneDrive interferes with initdb's file locking).
  dataDir = mkdtempSync(join(tmpdir(), "nookleus-pg-"));
  pgServer = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: await freePort(),
    user: "postgres",
    password: "postgres",
    persistent: false, // stop() wipes the data dir
    // Match prod: a UTF8 cluster. Without this, initdb inherits the Windows
    // WIN1252 locale and chokes on the UTF-8 arrows/box-drawing in the real
    // migration's comments. `--locale=C` keeps UTF8 valid on Windows (the
    // default 1252-based locale would otherwise force WIN1252 encoding).
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });

  await pgServer.initialise();
  await pgServer.start();
  await pgServer.createDatabase(TEST_DB);

  client = pgServer.getPgClient(TEST_DB);
  await client.connect();

  // The shipped migration ends with `GRANT EXECUTE ... TO authenticated`, a
  // role Supabase provides but a bare cluster doesn't. Create it so the real
  // SQL loads verbatim.
  await client.query(
    "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF; END $$;",
  );
  await client.query(SCHEMA_SQL); // tables first (the function's %ROWTYPE needs them)
  await client.query(MIGRATION_SQL); // #351: the original dual-shape function
  await client.query(CLEANUP_SQL); // #353: body swap to the flat-only function
  await client.query(NOTE_SQL); // #382: note-aware body swap (copies snapshot note)
}, 120_000);

afterAll(async () => {
  if (client) await client.end().catch(() => {});
  if (pgServer) await pgServer.stop().catch(() => {});
  // On Windows the cluster can still hold file handles when cleanup runs; a
  // failed rmSync must never fail an otherwise-green suite.
  if (dataDir) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* best-effort temp-dir cleanup */
    }
  }
});

/** Insert a fresh draft (empty) estimate under `orgId`; returns its id. */
async function seedDraftEstimate(orgId: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO estimates (organization_id, status) VALUES ($1, 'draft') RETURNING id",
    [orgId],
  );
  return rows[0].id;
}

interface ApplyResult {
  section_count: number;
  line_item_count: number;
}

interface LineItemRow {
  library_item_id: string | null;
  name: string | null;
  description: string;
  note: string | null;
  code: string | null;
  unit: string | null;
  quantity: string; // numeric -> string from pg
  unit_price: string;
  total: string;
}

describe("apply_template_to_estimate (snapshot shape, #351 → #353)", () => {
  // ── AC #3 (tracer): a freshly-authored snapshot template applies its own
  //    flat name/code/unit/description/qty/price straight onto the estimate. ──
  it("copies a snapshot item's flat fields onto the new line item", async () => {
    const orgId = randomUUID();
    const estimateId = await seedDraftEstimate(orgId);

    const structure = {
      sections: [
        {
          title: "Demolition",
          sort_order: 0,
          subsections: [],
          items: [
            {
              library_item_id: null,
              name: "Asbestos Testing",
              description: "Lab analysis of sample",
              code: "ABT-01",
              unit: "ea",
              quantity: 2,
              unit_price: 125.5,
              sort_order: 0,
            },
          ],
        },
      ],
    };
    const { rows: tmplRows } = await client.query<{ id: string }>(
      "INSERT INTO estimate_templates (organization_id, name, structure) VALUES ($1, $2, $3) RETURNING id",
      [orgId, "Asbestos Abatement", JSON.stringify(structure)],
    );
    const templateId = tmplRows[0].id;

    const { rows: resultRows } = await client.query<{ result: ApplyResult }>(
      "SELECT apply_template_to_estimate($1, $2) AS result",
      [estimateId, templateId],
    );
    expect(resultRows[0].result).toMatchObject({
      section_count: 1,
      line_item_count: 1,
    });

    const { rows: items } = await client.query<LineItemRow>(
      "SELECT * FROM estimate_line_items WHERE estimate_id = $1",
      [estimateId],
    );
    expect(items).toHaveLength(1);

    const item = items[0];
    expect(item.name).toBe("Asbestos Testing");
    expect(item.description).toBe("Lab analysis of sample");
    expect(item.code).toBe("ABT-01");
    expect(item.unit).toBe("ea");
    expect(item.library_item_id).toBeNull();
    expect(Number(item.quantity)).toBe(2);
    expect(Number(item.unit_price)).toBe(125.5);
    expect(Number(item.total)).toBe(251); // 2 × 125.50
  });

  // ── #382: a snapshot item's `note` survives the save-template → apply-template
  //    round trip onto the new estimate line item. ──────────────────────────────
  it("copies a snapshot item's note onto the new line item (#382)", async () => {
    const orgId = randomUUID();
    const estimateId = await seedDraftEstimate(orgId);

    const structure = {
      sections: [
        {
          title: "Mitigation",
          sort_order: 0,
          subsections: [],
          items: [
            {
              library_item_id: null,
              name: "Antimicrobial",
              description: "Apply to affected framing",
              note: "Use low-VOC product per homeowner request",
              code: "MIT-09",
              unit: "sqft",
              quantity: 100,
              unit_price: 0.75,
              sort_order: 0,
            },
          ],
        },
      ],
    };
    const { rows: tmplRows } = await client.query<{ id: string }>(
      "INSERT INTO estimate_templates (organization_id, name, structure) VALUES ($1, $2, $3) RETURNING id",
      [orgId, "Mitigation Pack", JSON.stringify(structure)],
    );

    await client.query("SELECT apply_template_to_estimate($1, $2) AS result", [
      estimateId,
      tmplRows[0].id,
    ]);

    const { rows: items } = await client.query<LineItemRow>(
      "SELECT * FROM estimate_line_items WHERE estimate_id = $1",
      [estimateId],
    );
    expect(items).toHaveLength(1);
    expect(items[0].note).toBe("Use low-VOC product per homeowner request");
  });

  // ── Post-#353: an un-backfilled legacy item (only a library_item_id plus
  //    `*_override` values, no flat fields) no longer resolves from the library
  //    or the overrides — it degrades to the NOT-NULL defaults. This is the
  //    behaviour change #353 introduces, and why #352 must run first. ─────────
  it("ignores library + override values for an un-backfilled legacy item", async () => {
    const orgId = randomUUID();
    const estimateId = await seedDraftEstimate(orgId);

    // A matching, active library row exists — but #353 never reads it.
    const { rows: libRows } = await client.query<{ id: string }>(
      `INSERT INTO item_library
         (organization_id, name, description, code, default_unit, default_quantity, unit_price)
       VALUES ($1, 'Drywall Repair', 'Library description', 'DRY-10', 'sqft', 5, 3.25)
       RETURNING id`,
      [orgId],
    );
    const libId = libRows[0].id;

    const structure = {
      sections: [
        {
          title: "Repairs",
          sort_order: 0,
          subsections: [],
          items: [
            {
              library_item_id: libId,
              // legacy shape: no flat fields, only overrides — both ignored now.
              description_override: "Legacy patch note",
              quantity_override: 7,
              unit_price_override: 4.5,
              sort_order: 0,
            },
          ],
        },
      ],
    };
    const { rows: tmplRows } = await client.query<{ id: string }>(
      "INSERT INTO estimate_templates (organization_id, name, structure) VALUES ($1, 'Legacy', $2) RETURNING id",
      [orgId, JSON.stringify(structure)],
    );

    const { rows: resultRows } = await client.query<{ result: ApplyResult }>(
      "SELECT apply_template_to_estimate($1, $2) AS result",
      [estimateId, tmplRows[0].id],
    );
    expect(resultRows[0].result).toMatchObject({ section_count: 1, line_item_count: 1 });

    const { rows: items } = await client.query<LineItemRow>(
      "SELECT * FROM estimate_line_items WHERE estimate_id = $1",
      [estimateId],
    );
    expect(items).toHaveLength(1);

    const item = items[0];
    // No library read → name/code/unit are null (the snapshot carried none).
    expect(item.name).toBeNull();
    expect(item.code).toBeNull();
    expect(item.unit).toBeNull();
    // No override read → description/quantity/unit_price hit the NOT-NULL floors.
    expect(item.description).toBe("[unknown item]");
    expect(Number(item.quantity)).toBe(1);
    expect(Number(item.unit_price)).toBe(0);
    expect(Number(item.total)).toBe(0);
    expect(item.library_item_id).toBe(libId); // breadcrumb still preserved
  });

  // ── Stray legacy fields don't leak: an item with flat fields plus leftover
  //    `*_override` values and a library pointer resolves purely from the flat
  //    snapshot — the overrides and the library row are ignored. ─────────────
  it("reads only the flat snapshot fields, ignoring stray override + library values", async () => {
    const orgId = randomUUID();
    const estimateId = await seedDraftEstimate(orgId);

    const { rows: libRows } = await client.query<{ id: string }>(
      `INSERT INTO item_library
         (organization_id, name, description, code, default_unit, default_quantity, unit_price)
       VALUES ($1, 'Lib Name', 'Lib desc', 'LIB', 'lf', 50, 1)
       RETURNING id`,
      [orgId],
    );
    const libId = libRows[0].id;

    const structure = {
      sections: [
        {
          title: "Mixed",
          sort_order: 0,
          subsections: [],
          items: [
            {
              library_item_id: libId,
              // flat snapshot — should win…
              name: "Flat Name",
              description: "Flat desc",
              code: "FLAT",
              unit: "ea",
              quantity: 3,
              unit_price: 9,
              // …over these legacy overrides…
              description_override: "OLD desc",
              quantity_override: 99,
              unit_price_override: 99,
              sort_order: 0,
            },
          ],
        },
      ],
    };
    const { rows: tmplRows } = await client.query<{ id: string }>(
      "INSERT INTO estimate_templates (organization_id, name, structure) VALUES ($1, 'Mixed', $2) RETURNING id",
      [orgId, JSON.stringify(structure)],
    );

    await client.query("SELECT apply_template_to_estimate($1, $2)", [estimateId, tmplRows[0].id]);

    const { rows: items } = await client.query<LineItemRow>(
      "SELECT * FROM estimate_line_items WHERE estimate_id = $1",
      [estimateId],
    );
    expect(items).toHaveLength(1);

    const item = items[0];
    expect(item.name).toBe("Flat Name");
    expect(item.description).toBe("Flat desc");
    expect(item.code).toBe("FLAT");
    expect(item.unit).toBe("ea");
    expect(Number(item.quantity)).toBe(3);
    expect(Number(item.unit_price)).toBe(9);
    expect(Number(item.total)).toBe(27); // 3 × 9, NOT 99×99 and NOT the library's 50×1
  });

  // ── Subsections: a subsection becomes a child estimate_section
  //    (parent_section_id → its parent), and its items attach to it. ─────────
  it("nests subsection items under a child section pointing at its parent", async () => {
    const orgId = randomUUID();
    const estimateId = await seedDraftEstimate(orgId);

    const structure = {
      sections: [
        {
          title: "Parent",
          sort_order: 0,
          items: [
            {
              library_item_id: null,
              name: "Parent Item",
              description: "top-level",
              code: "P-1",
              unit: "ea",
              quantity: 1,
              unit_price: 10,
              sort_order: 0,
            },
          ],
          subsections: [
            {
              title: "Child",
              sort_order: 0,
              items: [
                {
                  library_item_id: null,
                  name: "Sub Item",
                  description: "nested",
                  code: "S-1",
                  unit: "sqft",
                  quantity: 4,
                  unit_price: 2.5,
                  sort_order: 0,
                },
              ],
            },
          ],
        },
      ],
    };
    const { rows: tmplRows } = await client.query<{ id: string }>(
      "INSERT INTO estimate_templates (organization_id, name, structure) VALUES ($1, 'Nested', $2) RETURNING id",
      [orgId, JSON.stringify(structure)],
    );

    const { rows: resultRows } = await client.query<{ result: ApplyResult }>(
      "SELECT apply_template_to_estimate($1, $2) AS result",
      [estimateId, tmplRows[0].id],
    );
    // Parent section + subsection both count toward section_count.
    expect(resultRows[0].result).toMatchObject({ section_count: 2, line_item_count: 2 });

    const { rows: sections } = await client.query<{ id: string; title: string; parent_section_id: string | null }>(
      "SELECT id, title, parent_section_id FROM estimate_sections WHERE estimate_id = $1",
      [estimateId],
    );
    expect(sections).toHaveLength(2);
    const parent = sections.find((s) => s.parent_section_id === null)!;
    const child = sections.find((s) => s.parent_section_id !== null)!;
    expect(parent.title).toBe("Parent");
    expect(child.title).toBe("Child");
    expect(child.parent_section_id).toBe(parent.id);

    const { rows: items } = await client.query<{ name: string | null; section_id: string }>(
      "SELECT name, section_id FROM estimate_line_items WHERE estimate_id = $1",
      [estimateId],
    );
    const parentItem = items.find((i) => i.name === "Parent Item")!;
    const subItem = items.find((i) => i.name === "Sub Item")!;
    expect(parentItem.section_id).toBe(parent.id);
    expect(subItem.section_id).toBe(child.id);
  });

  // ── Post-#353: a dangling library_item_id (no resolvable row) is no longer a
  //    "broken ref" — with no library lookup, apply just inserts the snapshot
  //    ([unknown item] + defaults) and keeps the breadcrumb. The return value
  //    carries no broken_refs at all. ────────────────────────────────────────
  it("inserts a default line item for a dangling library_item_id and reports no broken_refs", async () => {
    const orgId = randomUUID();
    const estimateId = await seedDraftEstimate(orgId);

    const danglingLibId = randomUUID(); // no item_library row exists for this id

    const structure = {
      sections: [
        {
          title: "Orphans",
          sort_order: 0,
          subsections: [],
          items: [
            // lib-only legacy shape: nothing but a (now-dangling) breadcrumb.
            { library_item_id: danglingLibId, sort_order: 0 },
          ],
        },
      ],
    };
    const { rows: tmplRows } = await client.query<{ id: string }>(
      "INSERT INTO estimate_templates (organization_id, name, structure) VALUES ($1, 'Orphan', $2) RETURNING id",
      [orgId, JSON.stringify(structure)],
    );

    const { rows: resultRows } = await client.query<{ result: ApplyResult }>(
      "SELECT apply_template_to_estimate($1, $2) AS result",
      [estimateId, tmplRows[0].id],
    );
    const result = resultRows[0].result;
    expect(result).toMatchObject({ section_count: 1, line_item_count: 1 });
    expect(result).not.toHaveProperty("broken_refs");

    const { rows: items } = await client.query<LineItemRow>(
      "SELECT * FROM estimate_line_items WHERE estimate_id = $1",
      [estimateId],
    );
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.description).toBe("[unknown item]"); // NOT-NULL floor
    expect(item.name).toBeNull();
    expect(item.code).toBeNull();
    expect(item.unit).toBeNull();
    expect(Number(item.quantity)).toBe(1); // default
    expect(Number(item.unit_price)).toBe(0); // default
    expect(item.library_item_id).toBe(danglingLibId); // breadcrumb kept despite the dangling ref
  });

  // ── Totals: after inserting items, the RPC recomputes the estimate's money
  //    columns from its own markup/discount/tax settings. ────────────────────
  it("recomputes estimate totals from markup/discount/tax settings", async () => {
    const orgId = randomUUID();
    const { rows: estRows } = await client.query<{ id: string }>(
      `INSERT INTO estimates
         (organization_id, status, markup_type, markup_value, discount_type, discount_value, tax_rate)
       VALUES ($1, 'draft', 'percent', 10, 'amount', 5, 8.25)
       RETURNING id`,
      [orgId],
    );
    const estimateId = estRows[0].id;

    const structure = {
      sections: [
        {
          title: "Line",
          sort_order: 0,
          subsections: [],
          items: [
            {
              library_item_id: null,
              name: "Item",
              description: "d",
              code: null,
              unit: "ea",
              quantity: 2,
              unit_price: 100,
              sort_order: 0,
            },
          ],
        },
      ],
    };
    const { rows: tmplRows } = await client.query<{ id: string }>(
      "INSERT INTO estimate_templates (organization_id, name, structure) VALUES ($1, 'Totals', $2) RETURNING id",
      [orgId, JSON.stringify(structure)],
    );

    await client.query("SELECT apply_template_to_estimate($1, $2)", [estimateId, tmplRows[0].id]);

    const { rows } = await client.query<{
      subtotal: string;
      markup_amount: string;
      discount_amount: string;
      adjusted_subtotal: string;
      tax_amount: string;
      total: string;
    }>(
      `SELECT subtotal, markup_amount, discount_amount, adjusted_subtotal, tax_amount, total
       FROM estimates WHERE id = $1`,
      [estimateId],
    );
    const e = rows[0];
    expect(Number(e.subtotal)).toBe(200); // 2 × 100
    expect(Number(e.markup_amount)).toBe(20); // 10% of 200
    expect(Number(e.discount_amount)).toBe(5); // flat amount
    expect(Number(e.adjusted_subtotal)).toBe(215); // 200 + 20 − 5
    expect(Number(e.tax_amount)).toBe(17.74); // round(215 × 8.25%, 2)
    expect(Number(e.total)).toBe(232.74); // 215 + 17.74
  });

  // ── Guards: each precondition raises a distinct error code, surfaced by the
  //    `pg` client as a rejected query. ──────────────────────────────────────
  describe("guards", () => {
    it("rejects when the estimate does not exist (estimate_not_found)", async () => {
      const orgId = randomUUID();
      const { rows: tmpl } = await client.query<{ id: string }>(
        "INSERT INTO estimate_templates (organization_id, name) VALUES ($1, 'G') RETURNING id",
        [orgId],
      );
      await expect(
        client.query("SELECT apply_template_to_estimate($1, $2)", [randomUUID(), tmpl[0].id]),
      ).rejects.toThrow(/estimate_not_found/);
    });

    it("rejects when the estimate is not a draft (estimate_not_draft)", async () => {
      const orgId = randomUUID();
      const { rows: est } = await client.query<{ id: string }>(
        "INSERT INTO estimates (organization_id, status) VALUES ($1, 'sent') RETURNING id",
        [orgId],
      );
      const { rows: tmpl } = await client.query<{ id: string }>(
        "INSERT INTO estimate_templates (organization_id, name) VALUES ($1, 'G') RETURNING id",
        [orgId],
      );
      await expect(
        client.query("SELECT apply_template_to_estimate($1, $2)", [est[0].id, tmpl[0].id]),
      ).rejects.toThrow(/estimate_not_draft/);
    });

    it("rejects when the estimate already has sections (estimate_not_empty)", async () => {
      const orgId = randomUUID();
      const estimateId = await seedDraftEstimate(orgId);
      await client.query(
        "INSERT INTO estimate_sections (organization_id, estimate_id, title) VALUES ($1, $2, 'Pre-existing')",
        [orgId, estimateId],
      );
      const { rows: tmpl } = await client.query<{ id: string }>(
        "INSERT INTO estimate_templates (organization_id, name) VALUES ($1, 'G') RETURNING id",
        [orgId],
      );
      await expect(
        client.query("SELECT apply_template_to_estimate($1, $2)", [estimateId, tmpl[0].id]),
      ).rejects.toThrow(/estimate_not_empty/);
    });

    it("rejects when the template is inactive (template_not_found_or_inactive)", async () => {
      const orgId = randomUUID();
      const estimateId = await seedDraftEstimate(orgId);
      const { rows: tmpl } = await client.query<{ id: string }>(
        "INSERT INTO estimate_templates (organization_id, name, is_active) VALUES ($1, 'G', false) RETURNING id",
        [orgId],
      );
      await expect(
        client.query("SELECT apply_template_to_estimate($1, $2)", [estimateId, tmpl[0].id]),
      ).rejects.toThrow(/template_not_found_or_inactive/);
    });
  });
});
