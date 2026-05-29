// Integration coverage for migration-352 — the one-time backfill that rewrites
// every existing estimate_templates.structure item into the #351 snapshot shape
// (docs/adr/0004-template-line-items-snapshot.md).
//
// What this proves. After the backfill, every template item carries the flat
// snapshot fields (name/description/code/unit/quantity/unit_price), resolved
// the same way apply_template_to_estimate resolves them — library values for a
// live library_item_id, *_override values where the user had edited, NULL for
// the rest. The acceptance criteria of #352 map to the `it()` blocks below.
//
// Harness. Same embedded-postgres approach as apply-template.pg.test.ts: boot a
// throwaway cluster, load the focused schema + the LIVE migration-351 (so the
// AC#5 end-to-end apply runs the real RPC) + the LIVE migration-352 (the thing
// under test), and drive it through a raw `pg` client. Nothing here touches
// Docker or the network. Run with `npm run test:pg`.
//
// node-postgres parses jsonb columns into JS objects and JSON numbers into JS
// numbers, so structure assertions read fields directly; numeric *columns*
// (estimate_line_items.quantity etc.) still arrive as strings -> Number().

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
const APPLY_RPC_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-351-template-line-items-snapshot.sql"),
  "utf8",
);
const BACKFILL_SQL = readFileSync(
  join(process.cwd(), "supabase", "migration-352-backfill-templates-from-library.sql"),
  "utf8",
);

/** Grab a free ephemeral port so the cluster never collides with a local PG. */
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

/** Server NOTICE messages captured from the migration's RAISE NOTICE lines.
 *  Tests run sequentially within a file, so a test can clear this and inspect
 *  the notices its own runBackfill() produced. */
const capturedNotices: string[] = [];

const TEST_DB = "backfill_template_test";

beforeAll(async () => {
  // Data dir under the OS temp root, NOT the OneDrive-synced tree (OneDrive
  // interferes with initdb's file locking).
  dataDir = mkdtempSync(join(tmpdir(), "nookleus-pg-"));
  pgServer = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: await freePort(),
    user: "postgres",
    password: "postgres",
    persistent: false,
    // Match prod: a UTF8 cluster. `--locale=C` keeps UTF8 valid on Windows
    // (the default 1252 locale would force WIN1252 and choke on the UTF-8
    // box-drawing in the real migration comments).
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });

  await pgServer.initialise();
  await pgServer.start();
  await pgServer.createDatabase(TEST_DB);

  client = pgServer.getPgClient(TEST_DB);
  await client.connect();
  client.on("notice", (msg) => capturedNotices.push(msg.message ?? ""));

  // migration-351 ends with GRANT ... TO authenticated, a Supabase role a bare
  // cluster lacks. Create it so the real SQL loads verbatim.
  await client.query(
    "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF; END $$;",
  );
  await client.query(SCHEMA_SQL); // tables first
  await client.query(APPLY_RPC_SQL); // the live apply RPC (needed for AC#5)
}, 120_000);

afterAll(async () => {
  if (client) await client.end().catch(() => {});
  if (pgServer) await pgServer.stop().catch(() => {});
  // On Windows the cluster can still hold file handles when cleanup runs;
  // a failed rmSync must never fail an otherwise-green suite (matches the
  // .catch(() => {}) guards above).
  if (dataDir) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* best-effort temp-dir cleanup */
    }
  }
});

/** The migration is a whole-table `do $$ ... $$` block. Re-running it is the
 *  whole point (idempotency), so every test seeds its own template then calls
 *  this to sweep the table. */
async function runBackfill(): Promise<void> {
  await client.query(BACKFILL_SQL);
}

/** Insert an active library item under `orgId`; returns its id. */
async function seedLibraryItem(
  orgId: string,
  fields: { name: string; description: string; code: string | null; unit: string | null; quantity: number; unitPrice: number },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO item_library
       (organization_id, name, description, code, default_unit, default_quantity, unit_price)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [orgId, fields.name, fields.description, fields.code, fields.unit, fields.quantity, fields.unitPrice],
  );
  return rows[0].id;
}

/** Insert a template carrying a raw (pre-migration) structure; returns its id. */
async function seedTemplate(orgId: string, structure: unknown, name = "T"): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO estimate_templates (organization_id, name, structure) VALUES ($1, $2, $3) RETURNING id",
    [orgId, name, JSON.stringify(structure)],
  );
  return rows[0].id;
}

/** Insert a fresh draft (empty) estimate under `orgId`; returns its id. */
async function seedDraftEstimate(orgId: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO estimates (organization_id, status) VALUES ($1, 'draft') RETURNING id",
    [orgId],
  );
  return rows[0].id;
}

/** Read back a template's structure (pg parses jsonb -> JS object). */
async function getStructure(templateId: string): Promise<TemplateStructure> {
  const { rows } = await client.query<{ structure: TemplateStructure }>(
    "SELECT structure FROM estimate_templates WHERE id = $1",
    [templateId],
  );
  return rows[0].structure;
}

interface BackfilledItem {
  library_item_id: string | null;
  name: string | null;
  description: string | null;
  code: string | null;
  unit: string | null;
  quantity: number | null;
  unit_price: number | null;
  // legacy override fields may still be present (not asserted as removed)
  description_override?: unknown;
  quantity_override?: unknown;
  unit_price_override?: unknown;
  sort_order?: number;
}
interface TemplateStructure {
  sections: Array<{
    title: string;
    sort_order: number;
    items?: BackfilledItem[];
    subsections?: Array<{ title: string; sort_order: number; items?: BackfilledItem[] }>;
  }>;
}

describe("migration-352 backfill (snapshot shape, #352)", () => {
  // ── AC#2 tracer: a pre-migration library-backed item (no flat fields, only a
  //    breadcrumb + *_override edits) gets name/code/unit from the library and
  //    description/quantity/unit_price from the overrides (overrides win). ─────
  it("backfills a library-backed item: lib name/code/unit, override desc/qty/price", async () => {
    const orgId = randomUUID();
    const libId = await seedLibraryItem(orgId, {
      name: "Drywall Repair",
      description: "Library description",
      code: "DRY-10",
      unit: "sqft",
      quantity: 5,
      unitPrice: 3.25,
    });

    const templateId = await seedTemplate(orgId, {
      sections: [
        {
          title: "Repairs",
          sort_order: 0,
          items: [
            {
              library_item_id: libId,
              // legacy shape: no flat name/code/unit; only overrides for the
              // three fields the old builder could edit.
              description_override: "Legacy patch note",
              quantity_override: 7,
              unit_price_override: 4.5,
              sort_order: 0,
            },
          ],
        },
      ],
    });

    await runBackfill();

    const item = (await getStructure(templateId)).sections[0].items![0];
    // name/code/unit come from the library (the legacy item carried none)…
    expect(item.name).toBe("Drywall Repair");
    expect(item.code).toBe("DRY-10");
    expect(item.unit).toBe("sqft");
    // …description/quantity/unit_price prefer the explicit user override.
    expect(item.description).toBe("Legacy patch note");
    expect(item.quantity).toBe(7);
    expect(item.unit_price).toBe(4.5);
    // breadcrumb preserved.
    expect(item.library_item_id).toBe(libId);
  });

  // ── AC: a Custom item (library_item_id null) takes desc/qty/price from its
  //    *_override values; name/code/unit have no source, so they land as JSON
  //    null — but the KEYS are present (AC: "even if some are NULL"). ──────────
  it("backfills a custom item: overrides for desc/qty/price, null keys for name/code/unit", async () => {
    const orgId = randomUUID();
    const templateId = await seedTemplate(orgId, {
      sections: [
        {
          title: "Custom Work",
          sort_order: 0,
          items: [
            {
              library_item_id: null,
              description_override: "Hand-written scope",
              quantity_override: 3,
              unit_price_override: 12,
              sort_order: 0,
            },
          ],
        },
      ],
    });

    await runBackfill();

    const item = (await getStructure(templateId)).sections[0].items![0];
    expect(item.description).toBe("Hand-written scope");
    expect(item.quantity).toBe(3);
    expect(item.unit_price).toBe(12);
    // No library and no override source for these — null, but present.
    expect(item).toHaveProperty("name", null);
    expect(item).toHaveProperty("code", null);
    expect(item).toHaveProperty("unit", null);
    expect(item.library_item_id).toBeNull();
  });

  // ── AC: an item whose library_item_id no longer resolves — the row was
  //    hard-deleted (no row) OR soft-deleted (is_active = false) — backfills
  //    like a Custom item: copy whatever the structure preserved, leave
  //    name/code/unit null, keep the breadcrumb. ──────────────────────────────
  it("treats a dangling or inactive library_item_id like a custom item", async () => {
    const orgId = randomUUID();
    const danglingLibId = randomUUID(); // no item_library row exists for this id

    // A soft-deleted library row: present but is_active = false, so it must not
    // resolve (otherwise a deleted item's stale name would leak back in).
    const inactiveLibId = await seedLibraryItem(orgId, {
      name: "Soft Deleted",
      description: "should not surface",
      code: "GONE",
      unit: "ea",
      quantity: 9,
      unitPrice: 99,
    });
    await client.query("UPDATE item_library SET is_active = false WHERE id = $1", [inactiveLibId]);

    const templateId = await seedTemplate(orgId, {
      sections: [
        {
          title: "Orphans",
          sort_order: 0,
          items: [
            { library_item_id: danglingLibId, description_override: "kept note", sort_order: 0 },
            { library_item_id: inactiveLibId, sort_order: 1 },
          ],
        },
      ],
    });

    await runBackfill();

    const items = (await getStructure(templateId)).sections[0].items!;

    const dangling = items[0];
    expect(dangling.description).toBe("kept note"); // override copied
    expect(dangling).toHaveProperty("name", null); // no resolvable library name
    expect(dangling).toHaveProperty("code", null);
    expect(dangling).toHaveProperty("unit", null);
    expect(dangling).toHaveProperty("quantity", null); // no override, no library
    expect(dangling).toHaveProperty("unit_price", null);
    expect(dangling.library_item_id).toBe(danglingLibId); // breadcrumb kept

    const inactive = items[1];
    expect(inactive).toHaveProperty("name", null); // soft-deleted -> does NOT resolve
    expect(inactive).toHaveProperty("code", null);
    expect(inactive).toHaveProperty("unit", null);
    expect(inactive).toHaveProperty("quantity", null); // not the soft-deleted row's 9
    expect(inactive).toHaveProperty("unit_price", null); // not its 99
    expect(inactive.library_item_id).toBe(inactiveLibId);
  });

  // ── AC: items nested under a subsection are backfilled exactly like
  //    top-level items, and the section/subsection scaffolding (titles,
  //    sort_order) survives the rewrite. ──────────────────────────────────────
  it("backfills items nested inside subsections, preserving section scaffolding", async () => {
    const orgId = randomUUID();
    const libId = await seedLibraryItem(orgId, {
      name: "Floor Joist",
      description: "lib desc",
      code: "FJ-2",
      unit: "lf",
      quantity: 10,
      unitPrice: 8,
    });

    const templateId = await seedTemplate(orgId, {
      sections: [
        {
          title: "Framing",
          sort_order: 0,
          items: [{ library_item_id: null, description_override: "top item", quantity_override: 1, unit_price_override: 2, sort_order: 0 }],
          subsections: [
            {
              title: "Subfloor",
              sort_order: 0,
              items: [{ library_item_id: libId, sort_order: 0 }],
            },
          ],
        },
      ],
    });

    await runBackfill();

    const section = (await getStructure(templateId)).sections[0];
    // scaffolding intact
    expect(section.title).toBe("Framing");
    expect(section.subsections![0].title).toBe("Subfloor");

    // top-level item still backfilled
    expect(section.items![0].description).toBe("top item");

    // the nested item resolved from the library
    const subItem = section.subsections![0].items![0];
    expect(subItem.name).toBe("Floor Joist");
    expect(subItem.code).toBe("FJ-2");
    expect(subItem.unit).toBe("lf");
    expect(subItem.quantity).toBe(10); // library default (no override)
    expect(subItem.unit_price).toBe(8);
    expect(subItem.library_item_id).toBe(libId);
  });

  // ── AC: snapshot semantics. An already-authored flat snapshot (#351-onward,
  //    or a prior run) wins over the live library — editing the library must
  //    NOT rewrite an existing template item. ─────────────────────────────────
  it("never clobbers an existing flat snapshot, even when the library differs", async () => {
    const orgId = randomUUID();
    const libId = await seedLibraryItem(orgId, {
      name: "Renamed In Library",
      description: "new library desc",
      code: "NEW-CODE",
      unit: "new-unit",
      quantity: 50,
      unitPrice: 100,
    });

    const templateId = await seedTemplate(orgId, {
      sections: [
        {
          title: "Snapshot",
          sort_order: 0,
          items: [
            {
              library_item_id: libId,
              // a complete flat snapshot that disagrees with the library above
              name: "Original Snapshot Name",
              description: "original desc",
              code: "OLD-CODE",
              unit: "old-unit",
              quantity: 2,
              unit_price: 9,
              sort_order: 0,
            },
          ],
        },
      ],
    });

    await runBackfill();

    const item = (await getStructure(templateId)).sections[0].items![0];
    expect(item.name).toBe("Original Snapshot Name");
    expect(item.description).toBe("original desc");
    expect(item.code).toBe("OLD-CODE");
    expect(item.unit).toBe("old-unit");
    expect(item.quantity).toBe(2);
    expect(item.unit_price).toBe(9);
  });

  // ── AC: idempotent. Running the migration a second time produces a structure
  //    identical to the first run, across a mix of every item kind. ───────────
  it("is idempotent — a second run produces an identical structure", async () => {
    const orgId = randomUUID();
    const libId = await seedLibraryItem(orgId, {
      name: "Lib Item",
      description: "lib desc",
      code: "LIB-1",
      unit: "ea",
      quantity: 4,
      unitPrice: 6,
    });

    const templateId = await seedTemplate(orgId, {
      sections: [
        {
          title: "Mixed",
          sort_order: 0,
          items: [
            { library_item_id: libId, quantity_override: 11, sort_order: 0 }, // library-backed + override
            { library_item_id: null, description_override: "custom", sort_order: 1 }, // custom
            { library_item_id: randomUUID(), sort_order: 2 }, // dangling
          ],
          subsections: [
            { title: "Sub", sort_order: 0, items: [{ library_item_id: libId, sort_order: 0 }] },
          ],
        },
      ],
    });

    await runBackfill();
    const afterFirst = await getStructure(templateId);

    await runBackfill();
    const afterSecond = await getStructure(templateId);

    expect(afterSecond).toEqual(afterFirst);
  });

  // ── AC#5 end-to-end: a legacy library-backed template, once backfilled,
  //    applies onto a draft estimate producing line items that match — field
  //    for field — what the backfilled structure (i.e. the builder) shows, with
  //    no broken refs. ─────────────────────────────────────────────────────────
  it("apply of a backfilled template yields line items matching the structure", async () => {
    const orgId = randomUUID();
    const libId = await seedLibraryItem(orgId, {
      name: "Interior Paint",
      description: "library paint desc",
      code: "PT-1",
      unit: "gal",
      quantity: 2,
      unitPrice: 30,
    });

    // Pre-migration legacy item: only a breadcrumb + one user override.
    const templateId = await seedTemplate(orgId, {
      sections: [
        {
          title: "Finishes",
          sort_order: 0,
          items: [{ library_item_id: libId, unit_price_override: 35, sort_order: 0 }],
        },
      ],
    });

    await runBackfill();

    // What the builder will now show for that item (read straight from JSONB).
    const snap = (await getStructure(templateId)).sections[0].items![0];

    // Apply the backfilled template onto a fresh draft estimate.
    const estimateId = await seedDraftEstimate(orgId);
    const { rows: resultRows } = await client.query<{ result: ApplyResult }>(
      "SELECT apply_template_to_estimate($1, $2) AS result",
      [estimateId, templateId],
    );
    expect(resultRows[0].result).toMatchObject({ section_count: 1, line_item_count: 1, broken_refs: [] });

    const { rows: items } = await client.query<LineItemRow>(
      "SELECT * FROM estimate_line_items WHERE estimate_id = $1",
      [estimateId],
    );
    expect(items).toHaveLength(1);
    const li = items[0];

    // The applied line item matches the snapshot the builder displays.
    expect(li.name).toBe(snap.name);
    expect(li.description).toBe(snap.description);
    expect(li.code).toBe(snap.code);
    expect(li.unit).toBe(snap.unit);
    expect(Number(li.quantity)).toBe(snap.quantity);
    expect(Number(li.unit_price)).toBe(snap.unit_price);
    expect(Number(li.total)).toBe((snap.quantity as number) * (snap.unit_price as number));
    expect(li.library_item_id).toBe(libId);

    // Concretely: lib name/code/unit/desc/qty + the user's price override.
    expect(li.name).toBe("Interior Paint");
    expect(li.code).toBe("PT-1");
    expect(li.unit).toBe("gal");
    expect(li.description).toBe("library paint desc");
    expect(Number(li.quantity)).toBe(2);
    expect(Number(li.unit_price)).toBe(35);
    expect(Number(li.total)).toBe(70);
  });

  // ── Tenant isolation: a library_item_id that resolves to an ACTIVE row in a
  //    DIFFERENT org must NOT leak that row's name/code/unit/qty/price into this
  //    org's template. (Mirrors the org-scoped lookup the apply RPC uses.) ─────
  it("does not resolve a library_item_id that belongs to another organization", async () => {
    const orgA = randomUUID();
    const orgB = randomUUID();
    const foreignLibId = await seedLibraryItem(orgB, {
      name: "Foreign Item",
      description: "foreign desc",
      code: "FGN",
      unit: "ea",
      quantity: 3,
      unitPrice: 7,
    });

    const templateId = await seedTemplate(orgA, {
      sections: [{ title: "X", sort_order: 0, items: [{ library_item_id: foreignLibId, sort_order: 0 }] }],
    });

    await runBackfill();

    const item = (await getStructure(templateId)).sections[0].items![0];
    expect(item).toHaveProperty("name", null); // foreign row must not leak
    expect(item).toHaveProperty("code", null);
    expect(item).toHaveProperty("unit", null);
    expect(item).toHaveProperty("quantity", null);
    expect(item).toHaveProperty("unit_price", null);
    expect(item.library_item_id).toBe(foreignLibId); // breadcrumb preserved
  });

  // ── Empty-string flat values are treated as ABSENT (nullif fall-through), so
  //    a library-backed item with name:'' resolves the library name — not ''. ──
  it("treats empty-string flat values as absent and resolves from the library", async () => {
    const orgId = randomUUID();
    const libId = await seedLibraryItem(orgId, {
      name: "Lib Name",
      description: "lib desc",
      code: "LC",
      unit: "ea",
      quantity: 2,
      unitPrice: 5,
    });
    const templateId = await seedTemplate(orgId, {
      sections: [
        {
          title: "E",
          sort_order: 0,
          items: [{ library_item_id: libId, name: "", description: "", code: "", unit: "", sort_order: 0 }],
        },
      ],
    });

    await runBackfill();

    const item = (await getStructure(templateId)).sections[0].items![0];
    expect(item.name).toBe("Lib Name");
    expect(item.description).toBe("lib desc");
    expect(item.code).toBe("LC");
    expect(item.unit).toBe("ea");
  });

  // ── Per-field, mixed-rung resolution on a single item: flat beats *_override,
  //    *_override fills a gap with no flat value, library fills the rest. ───────
  it("resolves each field independently: flat > override > library", async () => {
    const orgId = randomUUID();
    const libId = await seedLibraryItem(orgId, {
      name: "Lib",
      description: "lib desc",
      code: "LC",
      unit: "ea",
      quantity: 8,
      unitPrice: 4,
    });
    const templateId = await seedTemplate(orgId, {
      sections: [
        {
          title: "M",
          sort_order: 0,
          items: [
            {
              library_item_id: libId,
              description: "flat desc", // flat present
              description_override: "legacy", // …should lose to the flat value
              quantity_override: 3, // no flat quantity, so this fills the gap
              sort_order: 0,
            },
          ],
        },
      ],
    });

    await runBackfill();

    const item = (await getStructure(templateId)).sections[0].items![0];
    expect(item.description).toBe("flat desc"); // flat beats override
    expect(item.quantity).toBe(3); // override fills the gap
    expect(item.name).toBe("Lib"); // library fills name/code/unit
    expect(item.code).toBe("LC");
    expect(item.unit).toBe("ea");
    expect(item.unit_price).toBe(4); // library (no flat, no override)
  });

  // ── "Nothing to do" is safe: an empty (sections:[]) and a sections-less ({})
  //    structure are left intact, with no error and no spurious keys. ──────────
  it("leaves empty and sections-less structures untouched without error", async () => {
    const orgId = randomUUID();
    const emptyId = await seedTemplate(orgId, { sections: [] });
    const bareId = await seedTemplate(orgId, {});

    await runBackfill();

    expect(await getStructure(emptyId)).toEqual({ sections: [] });
    expect(await getStructure(bareId)).toEqual({});
  });

  // ── The `is distinct from` guard: once everything is backfilled, a second run
  //    touches zero rows (it reports "0 template(s) to backfill"). ─────────────
  it("a second run is a no-op that reports zero templates to backfill", async () => {
    const orgId = randomUUID();
    await seedTemplate(orgId, {
      sections: [{ title: "N", sort_order: 0, items: [{ library_item_id: null, description_override: "x", sort_order: 0 }] }],
    });

    await runBackfill(); // backfills it (and any leftover rows from earlier tests)
    capturedNotices.length = 0;
    await runBackfill(); // nothing left distinct -> 0 rows

    expect(capturedNotices.some((n) => /migration-352: 0 template\(s\) to backfill/.test(n))).toBe(true);
  });

  // ── Robustness over dirty legacy data (#352 runs over arbitrary pre-#350
  //    structure JSONB). An explicit JSON-null items/subsections value must
  //    normalize to [] rather than abort the whole one-shot migration. ─────────
  it("tolerates JSON-null items/subsections, normalizing them to [] without aborting", async () => {
    const orgId = randomUUID();
    const templateId = await seedTemplate(orgId, {
      sections: [
        { title: "NullArrays", sort_order: 0, items: null, subsections: null },
        {
          title: "NullSubItems",
          sort_order: 1,
          items: [{ library_item_id: null, description_override: "ok", sort_order: 0 }],
          subsections: [{ title: "Sub", sort_order: 0, items: null }],
        },
      ],
    });

    await expect(runBackfill()).resolves.toBeUndefined(); // must NOT throw

    const s = await getStructure(templateId);
    expect(s.sections[0].items).toEqual([]); // null -> []
    expect(s.sections[0].subsections).toEqual([]); // null -> []
    expect(s.sections[1].subsections![0].items).toEqual([]); // nested null -> []
    expect(s.sections[1].items![0]).toHaveProperty("name", null); // good item still backfilled
    expect(s.sections[1].items![0].description).toBe("ok");

    // idempotent even over this dirty shape
    const first = await getStructure(templateId);
    await runBackfill();
    expect(await getStructure(templateId)).toEqual(first);
  });

  // ── A non-object section or item element (e.g. a JSON null) must be left
  //    EXACTLY as found — never `||`-concatenated into an array — and one dirty
  //    template must not block backfilling a clean sibling. ───────────────────
  it("leaves non-object section/item elements untouched and still backfills clean siblings", async () => {
    const orgId = randomUUID();

    // A clean template in the same org — must still get backfilled.
    const cleanId = await seedTemplate(orgId, {
      sections: [{ title: "Clean", sort_order: 0, items: [{ library_item_id: null, description_override: "clean", sort_order: 0 }] }],
    });

    // A dirty template: a null section element and a null item element.
    const dirtyId = await seedTemplate(orgId, {
      sections: [
        null, // non-object section element
        {
          title: "Mixed",
          sort_order: 1,
          items: [
            null, // non-object item element
            { library_item_id: null, description_override: "good", sort_order: 1 },
          ],
        },
      ],
    });

    await expect(runBackfill()).resolves.toBeUndefined(); // one bad row must NOT abort the run

    // The clean sibling is backfilled despite the dirty template existing.
    const clean = await getStructure(cleanId);
    expect(clean.sections[0].items![0]).toHaveProperty("name", null);
    expect(clean.sections[0].items![0].description).toBe("clean");

    // Malformed elements are preserved verbatim, not corrupted into arrays.
    const dirty = await getStructure(dirtyId);
    expect(dirty.sections[0]).toBeNull(); // null section preserved, NOT [null,{...}]
    expect(dirty.sections[1].items![0]).toBeNull(); // null item preserved, NOT [null,{...}]
    expect(dirty.sections[1].items![1].description).toBe("good"); // good sibling backfilled
    expect(dirty.sections[1].items![1]).toHaveProperty("name", null);

    // idempotent over the dirty shape
    const snapshot = await getStructure(dirtyId);
    await runBackfill();
    expect(await getStructure(dirtyId)).toEqual(snapshot);
  });
});

interface ApplyResult {
  section_count: number;
  line_item_count: number;
  broken_refs: unknown[];
}
interface LineItemRow {
  library_item_id: string | null;
  name: string | null;
  description: string;
  code: string | null;
  unit: string | null;
  quantity: string; // numeric -> string from pg
  unit_price: string;
  total: string;
}
