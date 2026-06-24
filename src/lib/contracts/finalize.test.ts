import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type {
  Contract,
  ContractEmailSettings,
  ContractSigner,
  ContractTemplate,
} from "./types";

vi.mock("./stamp-pdf", () => ({
  stampPdf: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
}));
vi.mock("./resolve-merge-values", () => ({
  resolveMergeValues: vi.fn(async () => ({})),
}));
vi.mock("./email-merge-fields", () => ({
  resolveEmailTemplate: vi.fn(async () => ({
    subject: "stub subject",
    html: "<p>stub body</p>",
    unresolvedFields: [],
  })),
}));
vi.mock("./email", () => ({
  sendContractEmail: vi.fn(async () => ({ provider: "resend", messageId: "msg-stub" })),
  resolveInternalRecipient: vi.fn(() => "internal@example.com"),
}));

import { finalizeSignedContract } from "./finalize";

beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

// Reset email-module mock impls before every test so a per-test
// `mockReturnValue` / `mockImplementation` override from a previous
// test does not leak. `vi.clearAllMocks` clears call history but
// preserves implementations.
beforeEach(async () => {
  const sendModule = await import("./email");
  vi.mocked(sendModule.sendContractEmail).mockImplementation(async () => ({
    provider: "resend",
    messageId: "msg-stub",
  }));
  vi.mocked(sendModule.resolveInternalRecipient).mockReturnValue(
    "internal@example.com",
  );
});

// ---------- Fixture builders --------------------------------------------

function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: "c-1",
    organization_id: "org-1",
    job_id: "job-1",
    template_id: "tpl-1",
    template_version: 1,
    title: "Roof Replacement Agreement",
    status: "viewed",
    filled_content_html: "",
    filled_content_hash: "",
    signed_pdf_path: null,
    customer_inputs: null,
    link_token: null,
    link_expires_at: null,
    sent_at: null,
    first_viewed_at: null,
    last_viewed_at: null,
    signed_at: null,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    reminder_count: 0,
    next_reminder_at: null,
    sent_by: null,
    created_at: "2026-05-13T00:00:00Z",
    updated_at: "2026-05-13T00:00:00Z",
    ...overrides,
  };
}

function makeTemplate(overrides: Partial<ContractTemplate> = {}): ContractTemplate {
  return {
    id: "tpl-1",
    organization_id: "org-1",
    name: "Roof Replacement",
    description: null,
    pdf_storage_path: "org-1/templates/tpl-1.pdf",
    pdf_page_count: 1,
    pdf_pages: [{ page: 1, width_pt: 612, height_pt: 792 }],
    overlay_fields: [],
    signer_count: 1,
    signer_role_label: "Homeowner",
    is_active: true,
    version: 1,
    created_by: null,
    created_at: "2026-05-13T00:00:00Z",
    updated_at: "2026-05-13T00:00:00Z",
    ...overrides,
  };
}

function makeSigner(overrides: Partial<ContractSigner> = {}): ContractSigner {
  return {
    id: "sig-1",
    organization_id: "org-1",
    contract_id: "c-1",
    signer_order: 1,
    role_label: "Homeowner",
    name: "Jane Customer",
    email: "jane@example.com",
    phone: null,
    signature_image_path: "org-1/contracts/c-1/signer-sig-1.png",
    typed_name: null,
    ip_address: null,
    user_agent: null,
    esign_consent_at: "2026-05-13T00:00:00Z",
    signed_at: "2026-05-13T00:00:00Z",
    created_at: "2026-05-13T00:00:00Z",
    ...overrides,
  };
}

function makeEmailSettings(
  overrides: Partial<ContractEmailSettings> = {},
): ContractEmailSettings {
  return {
    id: "ces-1",
    send_from_email: "no-reply@example.com",
    send_from_name: "Contracts",
    reply_to_email: "ops@example.com",
    provider: "resend",
    email_account_id: null,
    signing_request_subject_template: "",
    signing_request_body_template: "",
    signed_confirmation_subject_template: "",
    signed_confirmation_body_template: "",
    signed_confirmation_internal_subject_template: "",
    signed_confirmation_internal_body_template: "",
    reminder_subject_template: "",
    reminder_body_template: "",
    reminder_day_offsets: [3, 7],
    default_link_expiry_days: 14,
    button_label: "Review & sign",
    button_color: "#1f2937",
    logo_visible: true,
    signing_request_body_template_archived: null,
    updated_at: "2026-05-13T00:00:00Z",
    ...overrides,
  };
}

// ---------- Supabase fake -----------------------------------------------
//
// Scope: only the calls finalize.ts (and the writeContractEvent helper it
// calls) actually issue. Each table can be seeded with rows; queries match
// by `.eq()` filters. Errors can be injected per (table, op) key. Tracks
// every insert/update/upload so tests can assert on them.

type Filters = Record<string, unknown>;

interface PendingError {
  message: string;
}

interface FakeSupabase {
  client: ReturnType<typeof buildClient>;
  seed(table: string, rows: Record<string, unknown>[]): void;
  seedBlob(key: string, bytes: Uint8Array): void;
  clearTable(table: string): void;
  setError(key: string, error: PendingError | null): void;
  inserts: Record<string, Record<string, unknown>[]>;
  updates: Record<string, Array<{ values: Record<string, unknown>; filters: Filters }>>;
  storageUploads: Array<{ bucket: string; path: string; size: number; options?: unknown }>;
  storageDownloads: Array<{ bucket: string; path: string }>;
}

function buildClient(state: {
  rows: Record<string, Record<string, unknown>[]>;
  errors: Record<string, PendingError | null>;
  storageBlobs: Record<string, Uint8Array>;
  inserts: Record<string, Record<string, unknown>[]>;
  updates: Record<string, Array<{ values: Record<string, unknown>; filters: Filters }>>;
  storageUploads: Array<{ bucket: string; path: string; size: number; options?: unknown }>;
  storageDownloads: Array<{ bucket: string; path: string }>;
}) {
  function matchesFilters(row: Record<string, unknown>, filters: Filters): boolean {
    for (const [k, v] of Object.entries(filters)) {
      if (row[k] !== v) return false;
    }
    return true;
  }

  function selectBuilder(table: string) {
    const filters: Filters = {};
    const builder = {
      eq(col: string, val: unknown) {
        filters[col] = val;
        return builder;
      },
      order(_col: string) {
        void _col;
        return builder;
      },
      limit(_n: number) {
        void _n;
        return builder;
      },
      async maybeSingle() {
        const err = state.errors[`${table}.select`];
        if (err) return { data: null, error: err };
        const row = (state.rows[table] ?? []).find((r) => matchesFilters(r, filters));
        return { data: row ?? null, error: null };
      },
      async single() {
        const err = state.errors[`${table}.select`];
        if (err) return { data: null, error: err };
        const row = (state.rows[table] ?? []).find((r) => matchesFilters(r, filters));
        if (!row) return { data: null, error: { message: "not found" } };
        return { data: row, error: null };
      },
      // Awaiting a select chain without maybeSingle/single (e.g. .order())
      // resolves to { data: rows[] } per Supabase semantics.
      then(resolve: (v: { data: unknown; error: PendingError | null }) => unknown) {
        const err = state.errors[`${table}.select`];
        if (err) return resolve({ data: null, error: err });
        const rows = (state.rows[table] ?? []).filter((r) => matchesFilters(r, filters));
        return resolve({ data: rows, error: null });
      },
    };
    return builder;
  }

  function updateBuilder(table: string, values: Record<string, unknown>) {
    const filters: Filters = {};
    // Apply the update to every row matching every `.eq()` filter (the same
    // atomic guard Postgres applies), returning the affected rows.
    function apply(): { affected: Record<string, unknown>[]; error: PendingError | null } {
      state.updates[table] = state.updates[table] ?? [];
      state.updates[table].push({ values, filters });
      const err = state.errors[`${table}.update`];
      if (err) return { affected: [], error: err };
      const affected = (state.rows[table] ?? []).filter((r) => matchesFilters(r, filters));
      for (const row of affected) Object.assign(row, values);
      return { affected, error: null };
    }
    const builder = {
      eq(col: string, val: unknown) {
        filters[col] = val;
        return builder;
      },
      // `.update(...).eq(...).select(...).maybeSingle()` — returns the affected
      // row so a guarded update can tell whether it actually landed.
      select(_cols?: string) {
        void _cols;
        return {
          async maybeSingle() {
            const { affected, error } = apply();
            if (error) return { data: null, error };
            return { data: affected[0] ?? null, error: null };
          },
        };
      },
      then(resolve: (v: { data: unknown; error: PendingError | null }) => unknown) {
        const { error } = apply();
        return resolve({ data: null, error });
      },
    };
    return builder;
  }

  function insertBuilder(table: string, payload: Record<string, unknown>) {
    state.inserts[table] = state.inserts[table] ?? [];
    state.inserts[table].push(payload);
    return {
      then(resolve: (v: { data: unknown; error: PendingError | null }) => unknown) {
        const err = state.errors[`${table}.insert`];
        if (err) return resolve({ data: null, error: err });
        return resolve({ data: null, error: null });
      },
    };
  }

  function fromTable(table: string) {
    return {
      select(_cols?: string) {
        void _cols;
        return selectBuilder(table);
      },
      update(values: Record<string, unknown>) {
        return updateBuilder(table, values);
      },
      insert(payload: Record<string, unknown>) {
        return insertBuilder(table, payload);
      },
    };
  }

  function storageBucket(bucket: string) {
    return {
      async download(path: string) {
        state.storageDownloads.push({ bucket, path });
        const err = state.errors[`storage.${bucket}.download`];
        if (err) return { data: null, error: err };
        const bytes = state.storageBlobs[`${bucket}/${path}`];
        if (!bytes) return { data: null, error: { message: `not found: ${path}` } };
        return {
          data: {
            async arrayBuffer() {
              return bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
              );
            },
          },
          error: null,
        };
      },
      async upload(path: string, data: ArrayBuffer | Uint8Array, options?: unknown) {
        const size =
          data instanceof Uint8Array
            ? data.byteLength
            : (data as ArrayBuffer).byteLength;
        state.storageUploads.push({ bucket, path, size, options });
        const err = state.errors[`storage.${bucket}.upload`];
        if (err) return { data: null, error: err };
        return { data: { path }, error: null };
      },
    };
  }

  return {
    from: fromTable,
    storage: { from: storageBucket },
    // Unused by finalize but supabase clients expose it; keep available for
    // future tests of caller code if needed.
    rpc: async () => ({ data: null, error: null }),
    auth: {} as never,
  };
}

function makeSupabaseFake(): FakeSupabase {
  const state = {
    rows: {} as Record<string, Record<string, unknown>[]>,
    errors: {} as Record<string, PendingError | null>,
    storageBlobs: {} as Record<string, Uint8Array>,
    inserts: {} as Record<string, Record<string, unknown>[]>,
    updates: {} as Record<
      string,
      Array<{ values: Record<string, unknown>; filters: Filters }>
    >,
    storageUploads: [] as Array<{
      bucket: string;
      path: string;
      size: number;
      options?: unknown;
    }>,
    storageDownloads: [] as Array<{ bucket: string; path: string }>,
  };
  const client = buildClient(state);
  return {
    client: client as never,
    seed(table, rows) {
      state.rows[table] = state.rows[table] ?? [];
      state.rows[table].push(...rows);
    },
    seedBlob(key, bytes) {
      state.storageBlobs[key] = bytes;
    },
    clearTable(table) {
      state.rows[table] = [];
    },
    setError(key, error) {
      state.errors[key] = error;
    },
    get inserts() {
      return state.inserts;
    },
    get updates() {
      return state.updates;
    },
    get storageUploads() {
      return state.storageUploads;
    },
    get storageDownloads() {
      return state.storageDownloads;
    },
  };
}

// ---------- Tests --------------------------------------------------------

// Seed a Supabase fake with everything finalize needs to walk the
// full stamp-and-flip pipeline without errors. Tests override individual
// pieces by re-seeding or injecting errors.
function seedHappyPathFake(
  fake: FakeSupabase,
  opts: { contract?: Partial<Contract>; signers?: ContractSigner[] } = {},
) {
  const contract = makeContract(opts.contract);
  const signers =
    opts.signers ??
    [makeSigner()];
  fake.seed("contracts", [
    {
      id: contract.id,
      organization_id: contract.organization_id,
      status: contract.status,
      signed_pdf_path: contract.signed_pdf_path,
    },
  ]);
  fake.seed("contract_email_settings", [
    {
      ...makeEmailSettings(),
      organization_id: contract.organization_id,
    },
  ]);
  // Storage blobs for source PDF + each signer's signature image.
  const blob = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
  fake.seedBlob(`contract-pdfs/${makeTemplate().pdf_storage_path}`, blob);
  for (const s of signers) {
    if (s.signature_image_path) {
      fake.seedBlob(`contract-pdfs/${s.signature_image_path}`, blob);
    }
  }
  return { contract, signers };
}

describe("finalizeSignedContract — idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns wasAlreadyFinalized=true and no-ops when contract.status is already 'signed'", async () => {
    const fake = makeSupabaseFake();
    fake.seed("contracts", [
      {
        id: "c-1",
        organization_id: "org-1",
        status: "signed",
        signed_pdf_path: "org-1/contracts/c-1-signed.pdf",
      },
    ]);
    // stale in-memory snapshot — finalize must re-read status from DB.
    const stale = makeContract({ id: "c-1", status: "viewed", signed_pdf_path: null });

    const result = await finalizeSignedContract({
      supabase: fake.client as never,
      contract: stale,
      template: makeTemplate(),
      signers: [makeSigner()],
      customerInputs: {},
      signedAt: new Date("2026-05-13T12:00:00Z"),
    });

    expect(result.wasAlreadyFinalized).toBe(true);
    expect(result.signedPdfPath).toBe("org-1/contracts/c-1-signed.pdf");
    expect(fake.storageDownloads).toHaveLength(0);
    expect(fake.storageUploads).toHaveLength(0);
    expect(fake.updates["contracts"] ?? []).toHaveLength(0);
    expect(fake.inserts["contract_events"] ?? []).toHaveLength(0);
  });
});

describe("finalizeSignedContract — happy path return shape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns notifications.summary and per-recipient outcomes for one signer + internal", async () => {
    const sendModule = await import("./email");
    vi.mocked(sendModule.sendContractEmail).mockImplementation(async (_sb, _settings, args) => ({
      provider: "resend",
      messageId: args.to === "internal@example.com" ? "msg-internal" : "msg-customer",
    }));

    const fake = makeSupabaseFake();
    const signer = makeSigner({ id: "sig-1", email: "jane@example.com" });
    const { contract } = seedHappyPathFake(fake, { signers: [signer] });

    const result = await finalizeSignedContract({
      supabase: fake.client as never,
      contract,
      template: makeTemplate(),
      signers: [signer],
      customerInputs: {},
      signedAt: new Date("2026-05-13T12:00:00Z"),
    });

    expect(result.wasAlreadyFinalized).toBe(false);
    expect(result.signedPdfPath).toBe("org-1/contracts/c-1-signed.pdf");
    expect(result.notifications.summary).toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect(result.notifications.outcomes).toHaveLength(2);

    const customer = result.notifications.outcomes.find((o) => o.recipient === "customer");
    expect(customer).toMatchObject({
      recipient: "customer",
      signerId: "sig-1",
      to: "jane@example.com",
      result: { status: "sent", provider: "resend", messageId: "msg-customer" },
    });

    const internal = result.notifications.outcomes.find((o) => o.recipient === "internal");
    expect(internal).toMatchObject({
      recipient: "internal",
      to: "internal@example.com",
      result: { status: "sent", provider: "resend", messageId: "msg-internal" },
    });

    // One audit row per intended recipient.
    const events = fake.inserts["contract_events"] ?? [];
    expect(events).toHaveLength(2);
    const customerEvent = events.find(
      (e) =>
        ((e.metadata as Record<string, unknown>)?.kind) === "customer_confirmation",
    );
    expect(customerEvent?.metadata).toMatchObject({
      kind: "customer_confirmation",
      signer_id: "sig-1",
      provider: "resend",
      message_id: "msg-customer",
    });
    const internalEvent = events.find(
      (e) =>
        ((e.metadata as Record<string, unknown>)?.kind) === "internal_confirmation",
    );
    expect(internalEvent?.metadata).toMatchObject({
      kind: "internal_confirmation",
      provider: "resend",
      message_id: "msg-internal",
    });
  });
});

describe("finalizeSignedContract — mixed-outcome dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports {sent: 2, failed: 1, skipped: 0} when one customer email bounces", async () => {
    const sendModule = await import("./email");
    vi.mocked(sendModule.sendContractEmail).mockImplementation(async (_sb, _settings, args) => {
      if (args.to === "bouncer@example.com") {
        throw new Error("550 mailbox unavailable");
      }
      return {
        provider: "resend",
        messageId: args.to === "internal@example.com" ? "msg-internal" : `msg-${args.to}`,
      };
    });

    const fake = makeSupabaseFake();
    const signerA = makeSigner({ id: "sig-A", email: "alice@example.com", signer_order: 1 });
    const signerB = makeSigner({ id: "sig-B", email: "bouncer@example.com", signer_order: 2 });
    const { contract } = seedHappyPathFake(fake, { signers: [signerA, signerB] });

    const result = await finalizeSignedContract({
      supabase: fake.client as never,
      contract,
      template: makeTemplate(),
      signers: [signerA, signerB],
      customerInputs: {},
      signedAt: new Date("2026-05-13T12:00:00Z"),
    });

    expect(result.notifications.summary).toEqual({ sent: 2, failed: 1, skipped: 0 });
    expect(result.notifications.outcomes).toHaveLength(3);

    const aliceOutcome = result.notifications.outcomes.find((o) => o.signerId === "sig-A");
    expect(aliceOutcome?.result).toMatchObject({ status: "sent", provider: "resend" });

    const bouncerOutcome = result.notifications.outcomes.find((o) => o.signerId === "sig-B");
    expect(bouncerOutcome?.result).toMatchObject({
      status: "failed",
      error: expect.stringContaining("550 mailbox unavailable"),
    });
    expect(bouncerOutcome?.to).toBe("bouncer@example.com");

    const internalOutcome = result.notifications.outcomes.find((o) => o.recipient === "internal");
    expect(internalOutcome?.result).toMatchObject({ status: "sent" });

    // 3 audit rows: 2 customer + 1 internal, with metadata matching outcomes.
    const events = fake.inserts["contract_events"] ?? [];
    expect(events).toHaveLength(3);
    const failed = events.find(
      (e) =>
        ((e.metadata as Record<string, unknown>)?.signer_id) === "sig-B",
    );
    expect(failed?.metadata).toMatchObject({
      kind: "customer_confirmation",
      signer_id: "sig-B",
      error: expect.stringContaining("550 mailbox unavailable"),
    });
  });
});

describe("finalizeSignedContract — settings missing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("seals the contract and records one skipped row per intended recipient when settings row is absent", async () => {
    const fake = makeSupabaseFake();
    const signerA = makeSigner({ id: "sig-A", email: "alice@example.com", signer_order: 1 });
    const signerB = makeSigner({ id: "sig-B", email: "bob@example.com", signer_order: 2 });
    // Seed the happy-path fake but THEN clear contract_email_settings.
    const { contract } = seedHappyPathFake(fake, { signers: [signerA, signerB] });
    fake.clearTable("contract_email_settings");

    const sendModule = await import("./email");

    const result = await finalizeSignedContract({
      supabase: fake.client as never,
      contract,
      template: makeTemplate(),
      signers: [signerA, signerB],
      customerInputs: {},
      signedAt: new Date("2026-05-13T12:00:00Z"),
    });

    // Contract WAS sealed (status flip happened) even though settings missing.
    expect(result.signedPdfPath).toBe("org-1/contracts/c-1-signed.pdf");
    expect(result.wasAlreadyFinalized).toBe(false);

    // 3 skipped outcomes: 2 customers + 1 internal.
    expect(result.notifications.summary).toEqual({ sent: 0, failed: 0, skipped: 3 });
    expect(result.notifications.outcomes).toHaveLength(3);
    for (const o of result.notifications.outcomes) {
      expect(o.result).toMatchObject({ status: "skipped", reason: "settings_missing" });
      expect(o.to).toBeNull();
    }
    const customerOutcomes = result.notifications.outcomes.filter((o) => o.recipient === "customer");
    expect(customerOutcomes.map((o) => o.signerId).sort()).toEqual(["sig-A", "sig-B"]);
    expect(result.notifications.outcomes.find((o) => o.recipient === "internal")).toBeDefined();

    // No emails attempted.
    expect(sendModule.sendContractEmail).not.toHaveBeenCalled();

    // 3 audit rows, all with skipped_reason: settings_missing.
    const events = fake.inserts["contract_events"] ?? [];
    expect(events).toHaveLength(3);
    for (const e of events) {
      expect(e.metadata).toMatchObject({ skipped_reason: "settings_missing" });
    }
    const customerEvents = events.filter(
      (e) =>
        ((e.metadata as Record<string, unknown>)?.kind) === "customer_confirmation",
    );
    expect(customerEvents.map((e) => (e.metadata as Record<string, unknown>).signer_id).sort()).toEqual([
      "sig-A",
      "sig-B",
    ]);
    expect(
      events.find(
        (e) =>
          ((e.metadata as Record<string, unknown>)?.kind) === "internal_confirmation",
      ),
    ).toBeDefined();
  });
});

describe("finalizeSignedContract — no internal recipient resolved", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records internal recipient as skipped:no_internal_recipient when resolveInternalRecipient returns empty", async () => {
    const sendModule = await import("./email");
    vi.mocked(sendModule.resolveInternalRecipient).mockReturnValue("");

    const fake = makeSupabaseFake();
    const signer = makeSigner({ id: "sig-1", email: "jane@example.com" });
    const { contract } = seedHappyPathFake(fake, { signers: [signer] });

    const result = await finalizeSignedContract({
      supabase: fake.client as never,
      contract,
      template: makeTemplate(),
      signers: [signer],
      customerInputs: {},
      signedAt: new Date("2026-05-13T12:00:00Z"),
    });

    expect(result.notifications.summary).toEqual({ sent: 1, failed: 0, skipped: 1 });
    const internal = result.notifications.outcomes.find((o) => o.recipient === "internal");
    expect(internal).toMatchObject({
      recipient: "internal",
      to: null,
      result: { status: "skipped", reason: "no_internal_recipient" },
    });
    // Customer still sent.
    expect(
      result.notifications.outcomes.find((o) => o.recipient === "customer")?.result.status,
    ).toBe("sent");

    // Audit rows match: one sent customer + one skipped internal.
    const events = fake.inserts["contract_events"] ?? [];
    expect(events).toHaveLength(2);
    const internalEvent = events.find(
      (e) =>
        ((e.metadata as Record<string, unknown>)?.kind) === "internal_confirmation",
    );
    expect(internalEvent?.metadata).toMatchObject({
      kind: "internal_confirmation",
      skipped_reason: "no_internal_recipient",
    });
  });
});

describe("finalizeSignedContract — signer with null email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips signers with empty email but still attempts other signers and internal", async () => {
    const sendModule = await import("./email");
    vi.mocked(sendModule.sendContractEmail).mockImplementation(async (_sb, _settings, args) => ({
      provider: "resend",
      messageId: args.to === "internal@example.com" ? "msg-internal" : `msg-${args.to}`,
    }));

    const fake = makeSupabaseFake();
    const noEmailSigner = makeSigner({
      id: "sig-empty",
      email: "" as unknown as string,
      signer_order: 1,
    });
    const realSigner = makeSigner({
      id: "sig-real",
      email: "real@example.com",
      signer_order: 2,
    });
    const { contract } = seedHappyPathFake(fake, { signers: [noEmailSigner, realSigner] });

    const result = await finalizeSignedContract({
      supabase: fake.client as never,
      contract,
      template: makeTemplate(),
      signers: [noEmailSigner, realSigner],
      customerInputs: {},
      signedAt: new Date("2026-05-13T12:00:00Z"),
    });

    expect(result.notifications.summary).toEqual({ sent: 2, failed: 0, skipped: 1 });

    const skipped = result.notifications.outcomes.find((o) => o.signerId === "sig-empty");
    expect(skipped).toMatchObject({
      recipient: "customer",
      signerId: "sig-empty",
      to: null,
      result: { status: "skipped", reason: "no_signer_email" },
    });

    const sent = result.notifications.outcomes.find((o) => o.signerId === "sig-real");
    expect(sent?.result.status).toBe("sent");

    expect(
      result.notifications.outcomes.find((o) => o.recipient === "internal")?.result.status,
    ).toBe("sent");

    // 3 audit rows: 1 skipped + 1 sent + 1 internal sent.
    const events = fake.inserts["contract_events"] ?? [];
    expect(events).toHaveLength(3);
    const skippedEvent = events.find(
      (e) =>
        ((e.metadata as Record<string, unknown>)?.signer_id) === "sig-empty",
    );
    expect(skippedEvent?.metadata).toMatchObject({
      kind: "customer_confirmation",
      signer_id: "sig-empty",
      skipped_reason: "no_signer_email",
    });
  });
});

describe("finalizeSignedContract — job auto-advance (#721)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("advances a Lead (new) Job to in_progress when the contract is finalized", async () => {
    const fake = makeSupabaseFake();
    const { contract, signers } = seedHappyPathFake(fake);
    fake.seed("jobs", [{ id: contract.job_id, status: "new" }]);

    const result = await finalizeSignedContract({
      supabase: fake.client as never,
      contract,
      template: makeTemplate(),
      signers,
      customerInputs: {},
      signedAt: new Date("2026-05-13T12:00:00Z"),
    });

    expect(result.wasAlreadyFinalized).toBe(false);
    const jobUpdates = fake.updates["jobs"] ?? [];
    expect(jobUpdates).toHaveLength(1);
    expect(jobUpdates[0]).toMatchObject({
      values: { status: "in_progress" },
      filters: { id: contract.job_id },
    });
  });

  it("revives a Lost (cancelled) Job to in_progress when the contract is finalized", async () => {
    const fake = makeSupabaseFake();
    const { contract, signers } = seedHappyPathFake(fake);
    fake.seed("jobs", [{ id: contract.job_id, status: "cancelled" }]);

    await finalizeSignedContract({
      supabase: fake.client as never,
      contract,
      template: makeTemplate(),
      signers,
      customerInputs: {},
      signedAt: new Date("2026-05-13T12:00:00Z"),
    });

    const jobUpdates = fake.updates["jobs"] ?? [];
    expect(jobUpdates).toHaveLength(1);
    expect(jobUpdates[0]).toMatchObject({ values: { status: "in_progress" } });
  });

  it("leaves an Active (in_progress) Job unchanged — signing never moves it backward", async () => {
    const fake = makeSupabaseFake();
    const { contract, signers } = seedHappyPathFake(fake);
    fake.seed("jobs", [{ id: contract.job_id, status: "in_progress" }]);

    await finalizeSignedContract({
      supabase: fake.client as never,
      contract,
      template: makeTemplate(),
      signers,
      customerInputs: {},
      signedAt: new Date("2026-05-13T12:00:00Z"),
    });

    expect(fake.updates["jobs"] ?? []).toHaveLength(0);
  });

  it("does not touch the Job when re-finalizing an already-signed contract (idempotent)", async () => {
    const fake = makeSupabaseFake();
    fake.seed("contracts", [
      {
        id: "c-1",
        organization_id: "org-1",
        status: "signed",
        signed_pdf_path: "org-1/contracts/c-1-signed.pdf",
      },
    ]);
    // A Job that has since moved on (e.g. Collections) must stay put.
    fake.seed("jobs", [{ id: "job-1", status: "pending_invoice" }]);
    const stale = makeContract({ id: "c-1", status: "viewed", signed_pdf_path: null });

    const result = await finalizeSignedContract({
      supabase: fake.client as never,
      contract: stale,
      template: makeTemplate(),
      signers: [makeSigner()],
      customerInputs: {},
      signedAt: new Date("2026-05-13T12:00:00Z"),
    });

    expect(result.wasAlreadyFinalized).toBe(true);
    expect(fake.updates["jobs"] ?? []).toHaveLength(0);
  });

  it("still finalizes the contract when the Job update is rejected (best-effort)", async () => {
    const fake = makeSupabaseFake();
    const { contract, signers } = seedHappyPathFake(fake);
    fake.seed("jobs", [{ id: contract.job_id, status: "new" }]);
    fake.setError("jobs.update", { message: "rls denied" });

    const result = await finalizeSignedContract({
      supabase: fake.client as never,
      contract,
      template: makeTemplate(),
      signers,
      customerInputs: {},
      signedAt: new Date("2026-05-13T12:00:00Z"),
    });

    // Signing succeeded end-to-end even though the status nudge failed.
    expect(result.wasAlreadyFinalized).toBe(false);
    expect(result.signedPdfPath).toBe("org-1/contracts/c-1-signed.pdf");
  });
});

describe("finalizeSignedContract — error-checked status flip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws and dispatches no emails when contracts.update returns an error", async () => {
    const fake = makeSupabaseFake();
    const { contract, signers } = seedHappyPathFake(fake);
    fake.setError("contracts.update", { message: "rls denied" });

    const sendModule = await import("./email");

    await expect(
      finalizeSignedContract({
        supabase: fake.client as never,
        contract,
        template: makeTemplate(),
        signers,
        customerInputs: {},
        signedAt: new Date("2026-05-13T12:00:00Z"),
      }),
    ).rejects.toThrow(/rls denied|status.*flip|update/i);

    expect(sendModule.sendContractEmail).not.toHaveBeenCalled();
    expect(fake.inserts["contract_events"] ?? []).toHaveLength(0);
  });
});
