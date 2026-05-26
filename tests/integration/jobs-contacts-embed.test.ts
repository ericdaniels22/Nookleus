// Integration regression coverage for #282 — the six PostgREST embed
// surfaces that hit `jobs` → `contacts` after migration 193 introduced a
// second FK (`jobs.insurance_contact_id`) alongside the existing
// `jobs.contact_id`.
//
// Strategy. Each test imports the production embed string from
// `@/lib/embeds/jobs-contacts`, the same module the routes/pages use,
// and executes it against a local Supabase stack provisioned by
// `tests/integration/global-setup.ts`. The fixture is a single job
// linked to BOTH a homeowner and an insurance contact. The
// load-bearing assertion is that the embed returns the homeowner —
// not just that the query didn't error — because that's what proves
// the `!contact_id` disambiguation actually points where #282 intended.
//
// Smoke check. If you revert any of the constants in
// `src/lib/embeds/jobs-contacts.ts` to the bare `contact:contacts(*)`
// form, the corresponding test below fails with PGRST201. That's the
// harness sanity check called out in the issue.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ESTIMATE_TRASH_WITH_JOB_HOMEOWNER_EMBED,
  INVOICE_TRASH_WITH_JOB_HOMEOWNER_EMBED,
  JARVIS_JOB_CONTEXT_EMBED,
  JOB_WITH_HOMEOWNER_EMBED,
} from "@/lib/embeds/jobs-contacts";

let supabase: SupabaseClient;

let homeownerId: string;
let insurerId: string;
let adjusterId: string;
let jobId: string;
let estimateId: string;
let invoiceId: string;

beforeAll(async () => {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "[integration] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — global-setup did not run",
    );
  }

  supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Contacts: one homeowner, one insurer, one adjuster ──────────────────
  const { data: contacts, error: contactsErr } = await supabase
    .from("contacts")
    .insert([
      { full_name: "Homeowner Helen", role: "homeowner" },
      { full_name: "Insurer Inc.", role: "insurance" },
      { full_name: "Adjuster Adam", role: "adjuster" },
    ])
    .select();
  if (contactsErr || !contacts || contacts.length !== 3) {
    throw new Error(
      `[integration] contact fixture insert failed: ${contactsErr?.message ?? "no rows"}`,
    );
  }
  homeownerId = contacts.find((c) => c.role === "homeowner")!.id;
  insurerId = contacts.find((c) => c.role === "insurance")!.id;
  adjusterId = contacts.find((c) => c.role === "adjuster")!.id;

  // ── Job: linked to BOTH the homeowner and the insurer. This is what
  //    triggers PGRST201 against any un-disambiguated `contacts(*)` embed.
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert({
      job_number: "TEST-EMBED-001",
      contact_id: homeownerId,
      insurance_contact_id: insurerId,
    })
    .select()
    .single();
  if (jobErr || !job) {
    throw new Error(`[integration] job fixture insert failed: ${jobErr?.message ?? "no row"}`);
  }
  jobId = job.id;

  // ── Adjuster link: surface 6 (Jarvis) reads job_adjusters with an
  //    embed back to contacts; both arms of the embed disambiguate.
  const { error: adjErr } = await supabase
    .from("job_adjusters")
    .insert({ job_id: jobId, contact_id: adjusterId });
  if (adjErr) {
    throw new Error(`[integration] job_adjuster fixture insert failed: ${adjErr.message}`);
  }

  // ── Estimate + invoice rows, both soft-deleted so the trash listings
  //    pick them up.
  const trashedAt = new Date().toISOString();
  const { data: est, error: estErr } = await supabase
    .from("estimates")
    .insert({
      job_id: jobId,
      estimate_number: "EST-TEST-001",
      deleted_at: trashedAt,
    })
    .select()
    .single();
  if (estErr || !est) {
    throw new Error(`[integration] estimate fixture insert failed: ${estErr?.message ?? "no row"}`);
  }
  estimateId = est.id;

  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .insert({
      job_id: jobId,
      invoice_number: "INV-TEST-001",
      deleted_at: trashedAt,
    })
    .select()
    .single();
  if (invErr || !inv) {
    throw new Error(`[integration] invoice fixture insert failed: ${invErr?.message ?? "no row"}`);
  }
  invoiceId = inv.id;
});

afterAll(async () => {
  // Best-effort cleanup so a re-used local stack doesn't accumulate
  // fixtures. globalSetup wipes-and-recreates anyway, so failures are fine.
  if (!supabase) return;
  await supabase.from("job_adjusters").delete().eq("job_id", jobId);
  await supabase.from("estimates").delete().eq("id", estimateId);
  await supabase.from("invoices").delete().eq("id", invoiceId);
  await supabase.from("jobs").delete().eq("id", jobId);
  await supabase.from("contacts").delete().in("id", [homeownerId, insurerId, adjusterId]);
});

describe("jobs→contacts embed disambiguation", () => {
  // ── Surface 1: src/app/estimates/[id]/edit/page.tsx ────────────────────
  it("estimate-edit page: jobs→contact picks the homeowner", async () => {
    const { data, error } = await supabase
      .from("jobs")
      .select(JOB_WITH_HOMEOWNER_EMBED)
      .eq("id", jobId)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    // The load-bearing assertion: the embed picked the homeowner FK,
    // not the insurance one.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((data as any).contact.id).toBe(homeownerId);
  });

  // ── Surface 2: src/app/estimates/[id]/page.tsx ─────────────────────────
  it("estimate read-only view: jobs→contact picks the homeowner", async () => {
    const { data, error } = await supabase
      .from("jobs")
      .select(JOB_WITH_HOMEOWNER_EMBED)
      .eq("id", jobId)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((data as any).contact.id).toBe(homeownerId);
  });

  // ── Surface 3: src/app/invoices/[id]/edit/page.tsx ─────────────────────
  it("invoice-edit page: jobs→contact picks the homeowner", async () => {
    const { data, error } = await supabase
      .from("jobs")
      .select(JOB_WITH_HOMEOWNER_EMBED)
      .eq("id", jobId)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((data as any).contact.id).toBe(homeownerId);
  });

  // ── Surface 4: src/app/api/estimates/trash/route.ts ────────────────────
  it("estimates trash: nested job→contact picks the homeowner", async () => {
    const { data, error } = await supabase
      .from("estimates")
      .select(ESTIMATE_TRASH_WITH_JOB_HOMEOWNER_EMBED)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    const row = data!.find((r) => (r as { id: string }).id === estimateId)!;
    expect(row).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((row as any).job.contact.id).toBe(homeownerId);
  });

  // ── Surface 5: src/app/api/invoices/trash/route.ts ─────────────────────
  it("invoices trash: nested job→contact picks the homeowner", async () => {
    const { data, error } = await supabase
      .from("invoices")
      .select(INVOICE_TRASH_WITH_JOB_HOMEOWNER_EMBED)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    const row = data!.find((r) => (r as { id: string }).id === invoiceId)!;
    expect(row).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((row as any).job.contact.id).toBe(homeownerId);
  });

  // ── Surface 6: src/app/api/jarvis/field-ops/route.ts (get_job_context) ─
  it("Jarvis get_job_context: jobs→contact + job_adjusters→adjuster both resolve", async () => {
    const { data, error } = await supabase
      .from("jobs")
      .select(JARVIS_JOB_CONTEXT_EMBED)
      .eq("id", jobId)
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const job = data as any;
    expect(job.contact.id).toBe(homeownerId);
    // job_adjusters comes back as an array; the embedded `adjuster` row
    // must resolve to the adjuster contact we seeded above.
    expect(Array.isArray(job.job_adjusters)).toBe(true);
    expect(job.job_adjusters.length).toBe(1);
    expect(job.job_adjusters[0].adjuster.id).toBe(adjusterId);
  });
});
